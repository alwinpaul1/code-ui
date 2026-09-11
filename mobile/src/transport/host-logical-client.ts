import { AppState, Platform } from 'react-native'
import { connect, type RpcClient } from './rpc-client'
import { createStableLogicalRpcClient } from './stable-logical-rpc-client'
import type { ConnectionLogSink, HostProfile } from './types'
import { directPathForEndpoint } from './mobile-direct-endpoint-probe'
import { startMobileEndpointLifecycle } from './mobile-endpoint-lifecycle'

export type OpenHostLogicalClientOptions = {
  /** For the background notification listener: no Activity is on screen, so
   *  AppState is not the foreground signal, the relay is never suspended, and
   *  there is nobody waiting on latency so no direct-return probing. */
  backgroundLink?: boolean
}

export function openHostLogicalClient(
  host: HostProfile,
  onLog: ConnectionLogSink,
  options: OpenHostLogicalClientOptions = {}
): RpcClient {
  // Why: the stable facade owns app-visible RPC/subscription state while the
  // direct socket remains a replaceable first physical generation.
  const logical = createStableLogicalRpcClient(
    connect(host.endpoint, host.deviceToken, host.publicKeyB64, { onLog }),
    directPathForEndpoint(host, host.endpoint)
  )
  if (Platform.OS === 'web') {
    return logical
  }

  if (options.backgroundLink) {
    const endpointLifecycle = startMobileEndpointLifecycle(logical, host, onLog, {
      directReturnProbe: false
    })
    endpointLifecycle.setForeground(true)
    // Why: the lifecycle is pinned foreground so the relay is never suspended,
    // but nobody is reading a header on this link — its probes stay on the
    // background leash. Reviewed 2026-09-11: the foreground leash here meant a
    // dozing phone paid three times the relay probes all night.
    logical.setLivenessForeground?.(false)
    const closeLogical = logical.close
    logical.close = () => {
      endpointLifecycle.stop()
      closeLogical()
    }
    const notifyLogicalForeground = logical.notifyForeground
    logical.notifyForeground = (reason = 'focus') => {
      endpointLifecycle.nudge(reason)
      notifyLogicalForeground(reason)
    }
    return logical
  }

  const endpointLifecycle = startMobileEndpointLifecycle(logical, host, onLog)
  endpointLifecycle.setForeground(AppState.currentState === 'active')
  const appStateSubscription = AppState.addEventListener('change', (state) => {
    endpointLifecycle.setForeground(state === 'active')
  })
  const closeLogical = logical.close
  logical.close = () => {
    appStateSubscription.remove()
    endpointLifecycle.stop()
    closeLogical()
  }
  const notifyLogicalForeground = logical.notifyForeground
  logical.notifyForeground = (reason = 'focus') => {
    // Why: a nudge while already foreground must not re-enter setForeground —
    // that path suspended healthy relays; the supervisor probes or replaces instead.
    endpointLifecycle.nudge(reason)
    notifyLogicalForeground(reason)
  }
  return logical
}
