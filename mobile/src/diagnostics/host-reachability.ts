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
export function unreachableHostDetail(endpoint: string, localAddress?: string | null): string {
  const host = formatEndpoint(endpoint)
  if (isTailscaleEndpoint(endpoint)) {
    return `Cannot reach ${host} — check Tailscale`
  }
  if (localAddress != null && localAddress !== '') {
    let endpointHost: string
    try {
      endpointHost = new URL(endpoint).hostname
    } catch {
      return `Cannot reach ${host}`
    }
    const endpointNetwork = ipv4Slash24(endpointHost)
    const localNetwork = ipv4Slash24(localAddress)
    if (endpointNetwork != null && endpointNetwork === localNetwork) {
      return `Cannot reach ${host} — the phone is on that network, so the desktop is dropping LAN traffic (a full-tunnel VPN or Wi-Fi client isolation)`
    }
  }
  return `Cannot reach ${host}`
}
