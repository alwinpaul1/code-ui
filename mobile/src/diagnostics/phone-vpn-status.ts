import type { UnreachableHostContext } from './host-reachability'

/**
 * Whether this phone has a VPN up, read from Android's ConnectivityManager.
 *
 * Why a native check: expo-network reports the transport of the active network and tests WIFI
 * before VPN, so a VPN running over Wi-Fi reads as plain WIFI. On 2026-09-27 a friend's Pixel had
 * a VPN key in its status bar and Troubleshooting blamed the desktop for dropping LAN traffic.
 *
 * `unknown` is not "no VPN": the check is missing on this build or platform, or it failed. Callers
 * then say what they said before the check existed.
 */
export type PhoneVpnStatus =
  | {
      kind: 'known'
      /** A VPN network is up: the app's default network, or any network the OS lists. */
      active: boolean
      /** The app's own default network is the VPN, so its sockets go through the tunnel. */
      carriesAppTraffic: boolean
      /** Whether a VPN's routes cover the endpoint's IPv4 address; null when not asked or unreadable. */
      routesEndpoint: boolean | null
    }
  | { kind: 'unknown'; reason: string }

/** The native side, as `requireOptionalNativeModule` hands it over (see phone-vpn-native.ts). */
export type NativePhoneVpn = {
  phoneVpnStatus?: (endpointIpv4: string | null) => unknown
}

const UNAVAILABLE: PhoneVpnStatus = { kind: 'unknown', reason: 'check unavailable on this build' }
const MALFORMED: PhoneVpnStatus = { kind: 'unknown', reason: 'check returned an unexpected answer' }

/** Troubleshooting awaits this beside a 4 s LAN probe; a native call that never settles must not
 *  hold the host row with it. */
const PHONE_VPN_CHECK_TIMEOUT_MS = 2000
const TIMED_OUT = Symbol('timed out')

export async function readPhoneVpnStatus(
  endpoint: string,
  native: NativePhoneVpn | null
): Promise<PhoneVpnStatus> {
  if (native === null || typeof native.phoneVpnStatus !== 'function') {
    return UNAVAILABLE
  }
  let answer: unknown
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), PHONE_VPN_CHECK_TIMEOUT_MS)
    })
    // Called as a method: a native module's functions may read their module off `this`.
    answer = await Promise.race([native.phoneVpnStatus(endpointIpv4(endpoint)), timeout])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // The one line logcat keeps when the row falls back to its old copy.
    console.warn('[diagnostics] phone VPN check failed', message)
    return { kind: 'unknown', reason: `check failed: ${message}` }
  } finally {
    clearTimeout(timer)
  }
  if (answer === TIMED_OUT) {
    console.warn('[diagnostics] phone VPN check timed out')
    return {
      kind: 'unknown',
      reason: `check timed out after ${PHONE_VPN_CHECK_TIMEOUT_MS / 1000} s`
    }
  }
  return parseNativeAnswer(answer)
}

function parseNativeAnswer(answer: unknown): PhoneVpnStatus {
  if (typeof answer !== 'object' || answer === null) {
    return MALFORMED
  }
  const { active, carriesAppTraffic, routesEndpoint } = answer as Record<string, unknown>
  if (
    typeof active !== 'boolean' ||
    typeof carriesAppTraffic !== 'boolean' ||
    (routesEndpoint !== null && routesEndpoint !== undefined && typeof routesEndpoint !== 'boolean')
  ) {
    return MALFORMED
  }
  return { kind: 'known', active, carriesAppTraffic, routesEndpoint: routesEndpoint ?? null }
}

/** The endpoint's host when it is a dotted-quad IPv4 literal. Anything else is null: the native
 *  side reads routes for an address and must never resolve a name to get one. */
function endpointIpv4(endpoint: string): string | null {
  let hostname: string
  try {
    hostname = new URL(endpoint).hostname
  } catch {
    return null
  }
  const octets = hostname.split('.')
  return octets.length === 4 &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
    ? hostname
    : null
}

export function phoneVpnUnreachableContext(status: PhoneVpnStatus): UnreachableHostContext {
  return status.kind === 'known'
    ? { phoneVpnActive: status.active, phoneVpnRoutesEndpoint: status.routesEndpoint }
    : { phoneVpnActive: null, phoneVpnRoutesEndpoint: null }
}

/** The report's "Phone VPN:" line. */
export function describePhoneVpn(status: PhoneVpnStatus, endpoint: string): string {
  if (status.kind === 'unknown') {
    return `unknown (${status.reason})`
  }
  if (!status.active) {
    return 'none'
  }
  const parts = ['active', status.carriesAppTraffic ? 'carries this app' : 'this app bypasses it']
  const address = endpointIpv4(endpoint)
  if (status.routesEndpoint !== null && address !== null) {
    parts.push(status.routesEndpoint ? `routes ${address}` : `leaves ${address} alone`)
  }
  return parts.join(' · ')
}
