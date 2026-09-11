import * as ExpoCrypto from 'expo-crypto'
import type { ConnectionLogSink, ForegroundNudgeReason, HostProfile } from './types'
import { connect } from './rpc-client'
import { MobileEndpointSupervisor } from './mobile-endpoint-supervisor'
import { connectMobileRelayRpcSession } from './mobile-relay-rpc-session'
import { resolveMobileRelayEndpoint } from './mobile-relay-resume-director'
import {
  readMobileRelayCredentialBundle,
  writeMobileRelayCredentialBundle
} from './mobile-relay-credential-bundle'
import { saveHost } from './host-store'
import { readMobileNetworkIdentity, readMobileNetworkType } from './mobile-network-type'
import { upgradeDirectMobileRelay } from './mobile-relay-direct-upgrade'
import { MobileRelayDirectUpgradeController } from './mobile-relay-direct-upgrade-controller'
import type { StableLogicalRpcClient } from './stable-logical-rpc-client'

type EndpointLifecycle = {
  setForeground(foreground: boolean): void
  nudge(reason: ForegroundNudgeReason): void
  stop(): void
}

type EndpointOwner = EndpointLifecycle & {
  start(): Promise<void>
}

export type MobileEndpointLifecycleOptions = {
  /** Keep whatever path connects and never probe for a direct return; for the
   *  background notification listener, which has no user waiting on latency. */
  directReturnProbe?: boolean
}

export function startMobileEndpointLifecycle(
  logical: StableLogicalRpcClient,
  initialHost: HostProfile,
  onLog: ConnectionLogSink,
  options: MobileEndpointLifecycleOptions = {}
): EndpointLifecycle {
  let stopped = false
  let foreground = true
  let owner: EndpointOwner

  const startSupervisor = async (host: HostProfile): Promise<void> => {
    if (stopped) {
      return
    }
    const supervisor = createSupervisor(logical, host, onLog, options)
    owner.stop()
    owner = supervisor
    supervisor.setForeground(foreground)
    await supervisor.start()
  }

  if (initialHost.relay) {
    owner = createSupervisor(logical, initialHost, onLog, options)
    void owner.start()
  } else {
    owner = new MobileRelayDirectUpgradeController(logical, initialHost, {
      upgrade: (client, host) =>
        upgradeDirectMobileRelay({
          client,
          host,
          dependencies: { randomBytes: ExpoCrypto.getRandomBytes }
        }),
      onUpgraded: ({ host }) => startSupervisor(host)
    })
    void owner.start()
  }

  return {
    setForeground(next) {
      foreground = next
      owner.setForeground(next)
    },
    nudge(reason) {
      // Why: a focus nudge can precede the AppState listener; keep the closure in
      // sync or a later supervisor swap would start with a stale background flag.
      if (reason !== 'network-change') {
        foreground = true
      }
      owner.nudge(reason)
    },
    stop() {
      stopped = true
      owner.stop()
    }
  }
}

function createSupervisor(
  logical: StableLogicalRpcClient,
  host: HostProfile,
  onLog: ConnectionLogSink,
  options: MobileEndpointLifecycleOptions
): MobileEndpointSupervisor {
  return new MobileEndpointSupervisor(logical, host, {
    // Probes only (the launch race and the direct-return probe); the live
    // direct client is host-logical-client's. A probe's first refusal is its
    // verdict — see ConnectOptions.dialOnce.
    openDirect: (endpoint) =>
      connect(endpoint, host.deviceToken, host.publicKeyB64, { onLog, dialOnce: true }),
    openRelay: (relay, credential, confirmReqId, onHostCloseReason) =>
      connectMobileRelayRpcSession({
        relay,
        resumeToken: credential.token,
        resumeCredentialVersion: credential.version,
        resumeConfirmReqId: confirmReqId,
        deviceToken: host.deviceToken,
        desktopPublicKeyB64: host.publicKeyB64,
        onHostCloseReason,
        onLog
      }),
    resolveRelay: resolveMobileRelayEndpoint,
    readBundle: readMobileRelayCredentialBundle,
    writeBundle: writeMobileRelayCredentialBundle,
    saveHost,
    onLog,
    now: Date.now,
    randomBytes: ExpoCrypto.getRandomBytes,
    setTimer: setTimeout,
    clearTimer: clearTimeout,
    networkType: readMobileNetworkType,
    networkIdentity: readMobileNetworkIdentity,
    ...(options.directReturnProbe === undefined ? {} : { directReturnProbe: options.directReturnProbe })
  })
}
