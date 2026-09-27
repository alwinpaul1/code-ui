import { isTailscaleEndpoint } from '../../../src/shared/remote-runtime-tailscale-hint'
import { clientActivePath } from '../transport/host-client-context-state'
import { peekLiveHostClient, reusableParkedHostClient } from '../transport/live-host-clients'
import { mobileConnectionPathLabel } from '../transport/mobile-connection-path-label'
import type { RpcClientContextValue } from '../transport/rpc-client-context-contract'
import type { MobileConnectionPath } from '../transport/stable-logical-rpc-client'
import type { ConnectionState, HostProfile } from '../transport/types'
import { explainUnreachableHost, formatEndpoint, unreachableHostDetail } from './host-reachability'
import { phoneVpnUnreachableContext, type PhoneVpnStatus } from './phone-vpn-status'

export type TroubleshootCheck = {
  label: string
  status: 'pass' | 'fail' | 'warn'
  detail: string
}

/** The host's live client as the app holds it right now; `state` is null when there is none. */
export type HostLiveConnection = {
  state: ConnectionState | null
  path: MobileConnectionPath
}

/**
 * Whether the phone is on a network a LAN endpoint could be on, from expo-network's type. Null
 * when the type says nothing either way: VPN (expo-network names it only when no Wi-Fi or mobile
 * transport sits under it), UNKNOWN, OTHER, or no reading at all.
 */
export function phoneOnWifiFromNetworkType(type: string | null): boolean | null {
  switch (type) {
    case 'WIFI':
    case 'ETHERNET':
      return true
    case 'CELLULAR':
    case 'NONE':
    case 'BLUETOOTH':
    case 'WIMAX':
      return false
    default:
      return null
  }
}

/**
 * The host's live connection, state and path from the same client.
 *
 * `getKnownState` falls back to a client parked in the process after the screen tree was
 * destroyed, but `getActivePath` reads the store alone, so a parked relay session read as
 * "Direct · LAN" (review, 2026-09-27). This reads a parked client's path the way the host list
 * does (`use-all-host-clients.ts`).
 */
export function readHostLiveConnection(
  context: Pick<RpcClientContextValue, 'getAllClients' | 'getKnownState' | 'getActivePath'>,
  hostId: string
): HostLiveConnection {
  const stored = context.getAllClients().some((entry) => entry.hostId === hostId)
  const parked = stored ? null : reusableParkedHostClient(peekLiveHostClient(hostId))
  if (parked !== null) {
    return { state: parked.getState(), path: clientActivePath(parked) }
  }
  return { state: context.getKnownState(hostId), path: context.getActivePath(hostId) }
}

/**
 * One host's Troubleshooting row: a fresh probe of the saved direct endpoint, read against the
 * connection the app already holds.
 *
 * The probe alone said "Cannot reach" in red while Home said "Connected · Orca Relay" for the
 * same host (2026-09-27). A failed direct probe under a live connection is a degraded path, not
 * a dead host: it warns when the phone can name the cause, and passes over the relay when it
 * cannot. Red is kept for a host with no live connection at all.
 */
export function troubleshootHostCheck(args: {
  host: Pick<HostProfile, 'name' | 'endpoint'>
  reachable: boolean
  live: HostLiveConnection
  localAddress: string | null
  /** From the phone's network type; null when it could not be read. */
  phoneOnWifi?: boolean | null
  phoneVpn: PhoneVpnStatus
}): TroubleshootCheck {
  const { host, reachable, live, localAddress, phoneVpn } = args
  const endpoint = formatEndpoint(host.endpoint)
  if (reachable) {
    return { label: host.name, status: 'pass', detail: `Reachable at ${endpoint}` }
  }
  const context = { ...phoneVpnUnreachableContext(phoneVpn), phoneOnWifi: args.phoneOnWifi ?? null }
  if (live.state !== 'connected') {
    return {
      label: host.name,
      status: 'fail',
      detail: unreachableHostDetail(host.endpoint, localAddress, context)
    }
  }
  const connectedVia = `Connected via ${mobileConnectionPathLabel(live.path)}`
  if (live.path !== 'relay') {
    // The live socket is on the direct path the probe just failed, so the probe is the outlier.
    return {
      label: host.name,
      status: 'warn',
      detail: `${connectedVia} · a fresh probe of ${endpoint} did not answer`
    }
  }
  // The relay is a working path. A down direct path is worth a line only when the phone can say
  // why: "direct Tailscale path unavailable (check Tailscale)" and a bare "did not answer" named
  // nothing to fix, and read as a fault on a healthy connection (2026-09-27).
  if (isTailscaleEndpoint(host.endpoint)) {
    return { label: host.name, status: 'pass', detail: connectedVia }
  }
  const { reason, hint } = explainUnreachableHost(host.endpoint, localAddress, context)
  if (reason === null && hint === null) {
    return { label: host.name, status: 'pass', detail: connectedVia }
  }
  return {
    label: host.name,
    status: 'warn',
    detail: `${connectedVia} · direct Wi-Fi path unavailable (${reason ?? `${endpoint} did not answer`})${hint ? `. ${hint}` : ''}`
  }
}
