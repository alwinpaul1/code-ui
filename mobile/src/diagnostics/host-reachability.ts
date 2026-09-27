import { isTailscaleEndpoint } from '../../../src/shared/remote-runtime-tailscale-hint'

const HOST_REACHABILITY_TIMEOUT_MS = 4000

// Why: troubleshooting needs a cheap endpoint probe without completing the
// encrypted mobile runtime handshake.
export async function testHostReachability(endpoint: string): Promise<boolean> {
  return new Promise((resolve) => {
    let ws: WebSocket
    try {
      ws = new WebSocket(endpoint)
    } catch {
      resolve(false)
      return
    }

    let settled = false
    let timeout: ReturnType<typeof setTimeout> | null = null

    const finish = (reachable: boolean, closeSocket: boolean): void => {
      if (settled) {
        return
      }
      settled = true
      if (timeout) {
        clearTimeout(timeout)
        timeout = null
      }
      if (closeSocket) {
        try {
          ws.close()
        } catch {
          // The probe is already complete; close failures should not change the diagnostic result.
        }
      }
      resolve(reachable)
    }

    timeout = setTimeout(() => {
      finish(false, true)
    }, HOST_REACHABILITY_TIMEOUT_MS)

    ws.onopen = () => {
      finish(true, true)
    }

    ws.onerror = () => {
      finish(false, true)
    }
  })
}

export function formatEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint)
    return url.host
  } catch {
    return 'invalid endpoint'
  }
}

/**
 * The IPv4 /24 an address belongs to, or null for anything that is not a plain
 * dotted-quad. A /24 is the coarse test on purpose: the phone cannot read the
 * desktop's netmask, and every home router this client meets hands out a /24.
 */
function ipv4Slash24(address: string): string | null {
  const octets = address.trim().split('.')
  if (octets.length !== 4) {
    return null
  }
  for (const octet of octets) {
    if (!/^\d{1,3}$/.test(octet) || Number(octet) > 255) {
      return null
    }
  }
  return octets.slice(0, 3).join('.')
}

/**
 * What the phone knows about its own VPN when a host does not answer. Every field may be null or
 * absent: the native check is missing on an older build or another platform, or it failed, and
 * then the copy falls back to what it said before the check existed.
 */
export type UnreachableHostContext = {
  /** A VPN is up on this phone (Android's TRANSPORT_VPN on the active network or any network). */
  phoneVpnActive?: boolean | null
  /** Whether that VPN's routes cover the endpoint's address. */
  phoneVpnRoutesEndpoint?: boolean | null
  /**
   * Whether the phone is on Wi-Fi, from its network type. Without it, a readable Wi-Fi address is
   * the evidence: the phone's address is WifiInfo's, which reads as none off Wi-Fi.
   */
  phoneOnWifi?: boolean | null
}

/** Why a direct endpoint does not answer, as far as the phone can tell, and a hint about the
 *  network it sits on. Either may be null. `host` is the endpoint as printable text. */
export type UnreachableHostExplanation = {
  host: string
  reason: string | null
  hint: string | null
}

const PHONE_VPN_REASON =
  'a VPN on this phone is routing local traffic away from your desktop; allow LAN access in the VPN app or pause it'
const DESKTOP_DROPPING_REASON =
  'the phone is on that network, so the desktop is dropping LAN traffic (a full-tunnel VPN or Wi-Fi client isolation)'
const VPN_LEAVES_LAN_REASON =
  "the phone is on that network and its VPN leaves local traffic alone; check the desktop's firewall and any VPN there, and Wi-Fi client isolation"

// Why: an unreachable 100.x/*.ts.net host almost always means the phone's
// Tailscale tunnel is down or wedged (known iOS failure mode, fixed by
// toggling the VPN) — point at that instead of a bare "Cannot reach".
//
// Why the subnet arm: on 2026-09-12 the phone sat on 192.168.1.143 with working
// internet and the desk on 192.168.1.154 answered nothing, because Cisco Secure
// Client had put 192.168.1.0/24 into its own tunnel (Tunnel All Traffic, with
// LocalLanAccess forced false). A bare "Cannot reach" sent the user hunting
// through the phone's Wi-Fi settings. When the phone is demonstrably ON the
// endpoint's network, the phone is not the suspect — the desktop is.
//
// Why the phone's VPN comes first: on 2026-09-27 a friend's Pixel had a VPN key
// in its status bar and sat on the desktop's own hotspot, and this said "the
// desktop is dropping LAN traffic". The subnet match alone cannot tell a VPN on
// the phone from one on the desktop, and expo-network reports a VPN over Wi-Fi
// as plain WIFI, so the phone's own VPN was invisible. With one up, it is the
// first suspect, unless its routes are known to leave the endpoint alone.
export function explainUnreachableHost(
  endpoint: string,
  localAddress?: string | null,
  context: UnreachableHostContext = {}
): UnreachableHostExplanation {
  const host = formatEndpoint(endpoint)
  if (isTailscaleEndpoint(endpoint)) {
    return { host, reason: 'check Tailscale', hint: null }
  }
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return { host, reason: null, hint: null }
  }
  const hint = windowsHotspotHint(url)
  const endpointNetwork = ipv4Slash24(url.hostname)
  const localNetwork =
    localAddress != null && localAddress !== '' ? ipv4Slash24(localAddress) : null
  const sameNetwork = endpointNetwork != null && endpointNetwork === localNetwork
  // The VPN is the suspect only for a phone on Wi-Fi and not provably on another /24. Off Wi-Fi
  // (an always-on VPN over mobile data) no LAN is in reach whatever the VPN does, and a Wi-Fi
  // address on another /24 means the phone is not on the desktop's network at all.
  const onWifi = context.phoneOnWifi ?? localNetwork != null
  const onAnotherNetwork =
    endpointNetwork != null && localNetwork != null && endpointNetwork !== localNetwork
  if (
    context.phoneVpnActive === true &&
    context.phoneVpnRoutesEndpoint !== false &&
    onWifi &&
    !onAnotherNetwork
  ) {
    return { host, reason: PHONE_VPN_REASON, hint }
  }
  if (!sameNetwork) {
    return { host, reason: null, hint }
  }
  return {
    host,
    reason: context.phoneVpnActive === true ? VPN_LEAVES_LAN_REASON : DESKTOP_DROPPING_REASON,
    hint
  }
}

export function unreachableHostDetail(
  endpoint: string,
  localAddress?: string | null,
  context?: UnreachableHostContext
): string {
  const { host, reason, hint } = explainUnreachableHost(endpoint, localAddress, context)
  return `Cannot reach ${host}${reason ? ` — ${reason}` : ''}${hint ? `. ${hint}` : ''}`
}

/**
 * 192.168.137.0/24 is the network Windows hands out from Mobile Hotspot (Internet Connection
 * Sharing), with the PC itself on .1. Windows Firewall often files that adapter under the Public
 * profile, and Public blocks an inbound port nobody allowed there.
 */
function windowsHotspotHint(url: URL): string | null {
  if (ipv4Slash24(url.hostname) !== '192.168.137') {
    return null
  }
  // A URL with no port uses its scheme's default, which is what the socket dialled.
  const port = url.port !== '' ? url.port : url.protocol === 'wss:' ? '443' : '80'
  return `192.168.137.x is Windows' Mobile Hotspot network, where Windows Firewall often treats the adapter as Public and blocks port ${port}`
}
