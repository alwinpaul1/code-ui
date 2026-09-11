import { livenessProfileFor } from './liveness-foreground-profile'
import {
  PairingGetEndpointsResultSchema,
  type DeviceResumeConfirmed,
  type MobileRelayEndpoint
} from '../../../src/shared/mobile-relay-credential-contract'
import { MobileRelayE2eeLink } from './mobile-relay-e2ee-link'
import { MobileRelayRpcStreams } from './mobile-relay-rpc-streams'
import { MobileE2EEAuthenticationError } from './mobile-e2ee-v2-physical-channel'
import { markRpcDeliveryUnknown } from './rpc-delivery-ambiguity'
import { openRpcRequestBudget, resolvePostConnectRequestTimeout } from './rpc-request-budget'
import { isRpcResponse } from './rpc-response-shape'
import {
  RelayDialStageTracker,
  type RelayDialStageSource,
  type RelayDialTimings
} from './relay-dial-stage'
import { RelayPendingRequests } from './relay-pending-requests'
import { waitForRelaySessionConnected } from './relay-session-wait-for-connected'
import { RpcSessionLivenessWatchdog } from './rpc-session-liveness-watchdog'
import { settleMobileRuntimeCapabilities } from './mobile-runtime-capability-negotiation'
import type { RelayHostCloseReason } from '../../../src/shared/relay-host-close-reason'
import type { RpcClient } from './rpc-client'
import type { ConnectionLogSink, ConnectionState, RpcResponse } from './types'

// Why 30 s: long enough that an active session almost never pays for it (any
// inbound frame defers it), short enough that a half-open relay socket — cell
// restart with no FIN, NAT rebind on cellular — is noticed in well under a
// minute instead of only when the user next foregrounds the app. Before
// 2026-09-09 the relay had no idle probe at all.
const RELAY_IDLE_PROBE_MS = 30_000
const RELAY_PROBE_TIMEOUT_MS = 4_000
// Measured on a Galaxy S23: 30 s + 2 × 4 s = 38 s of "Connected · Orca Relay" on
// a relay socket that was already dead. Foregrounded, the user is looking at
// that header; a relay probe is billed, so the leash only shortens while they are.
const RELAY_LIVENESS_PROFILES = {
  foreground: { idleProbeMs: 10_000, probeTimeoutMs: 2_000 },
  background: { idleProbeMs: RELAY_IDLE_PROBE_MS, probeTimeoutMs: RELAY_PROBE_TIMEOUT_MS }
}
const RELAY_MISSED_PROBE_LIMIT = 2
const RELAY_FOREGROUND_PROBE_MIN_INTERVAL_MS = 10_000
let relayRpcSessionSequence = 0

export type MobileRelayRpcSession = RpcClient &
  RelayDialStageSource & {
    // The cell's attach-reservation deadline (~10s). Diagnostics only — never
    // schedule anything from it; rotation keys off getResumeExpiresAt().
    getAttachDeadlineAt(): number | null
    getResumeExpiresAt(): number | null
    getResumeConfirmation(): DeviceResumeConfirmed | null
    getFailure(): Error | null
    /** When each dial leg began; for the "dialed in" log line. */
    getDialTimings(): RelayDialTimings
  }

export function connectMobileRelayRpcSession(args: {
  relay: MobileRelayEndpoint
  resumeToken: string
  resumeCredentialVersion: number
  resumeConfirmReqId: string
  deviceToken: string
  desktopPublicKeyB64: string
  requestTimeoutMs?: number
  createSocket?: (url: string) => WebSocket
  onHostCloseReason?: (reason: RelayHostCloseReason) => void
  onLog?: ConnectionLogSink
}): MobileRelayRpcSession {
  const requestTimeoutMs = args.requestTimeoutMs ?? 30_000
  const pending = new RelayPendingRequests()
  const stateListeners = new Set<(state: ConnectionState) => void>()
  let state: ConnectionState = 'connecting'
  let lastConnectedAt: number | null = null
  let attachDeadlineAt: number | null = null
  let resumeExpiresAt: number | null = null
  let resumeConfirmation: DeviceResumeConfirmed | null = null
  let failure: Error | null = null
  let closed = false
  let logSequence = 0
  const logSessionId = `${Date.now().toString(36)}-${(++relayRpcSessionSequence).toString(36)}`
  const livenessIdentity = {}
  const dialStage = new RelayDialStageTracker()
  const streams = new MobileRelayRpcStreams({
    nextId: () => pending.nextId(),
    sendFrame,
    waitForConnected: () => waitForConnected()
  })

  const link = new MobileRelayE2eeLink({
    endpoint: args.relay,
    credential: args.resumeToken,
    expectedCredentialKind: 'resume',
    deviceToken: args.deviceToken,
    desktopPublicKeyB64: args.desktopPublicKeyB64,
    createSocket: args.createSocket,
    onHostCloseReason: args.onHostCloseReason,
    onOpen: () => dialStage.advance('awaiting-hello'),
    onHello: (hello) => {
      if (
        hello.credentialKind !== 'resume' ||
        hello.acceptedCredentialVersion !== args.resumeCredentialVersion
      ) {
        fail(new Error('relay resume credential version mismatch'))
        return
      }
      attachDeadlineAt = hello.leaseExpiresAt
      resumeExpiresAt = hello.resumeExpiresAt
      dialStage.advance('handshaking')
      publishState('handshaking')
    },
    onAuthenticated: () => void confirmResume(),
    onText: (plaintext) => {
      livenessWatchdog.noteAuthenticatedInbound(livenessIdentity)
      handleText(plaintext)
    },
    onBinary: (plaintext) => {
      livenessWatchdog.noteAuthenticatedInbound(livenessIdentity)
      handleBinary(plaintext)
    },
    onError: fail
  })

  const client: MobileRelayRpcSession = {
    async sendRequest(method, params, options) {
      // Why: publishState is edge-triggered, so a request arriving after fail()
      // would never see a state event and could only die on the 30 s timer —
      // one such keystroke parked the live-input queue for 30 s on a Galaxy S23.
      if (closed) {
        throw new Error(`relay session ${state}: ${failure?.message ?? 'closed'}`)
      }
      if (options?.failWhenDisconnected && state !== 'connected') {
        // Same contract the direct client honours (rpc-client-request-tracker).
        throw new Error(`Not connected: ${method}`)
      }
      const budget = openRpcRequestBudget(options)
      await waitForConnected(budget.timeoutMs)
      return sendRpc(method, params, resolvePostConnectRequestTimeout(budget, requestTimeoutMs))
    },

    subscribe(method, params, listener, options) {
      if (closed) {
        return () => {}
      }
      return streams.subscribe(method, params, listener, options)
    },

    updateTerminalSubscriptionViewport(terminal, viewport) {
      streams.updateTerminalViewport(terminal, viewport)
    },
    getState: () => state,
    getReconnectAttempt: () => 0,
    getLastConnectedAt: () => lastConnectedAt,
    getLastInboundAt: () => livenessWatchdog.getLastInboundAt() || null,
    isLivenessProbing: () => livenessWatchdog.isProbing(),
    onLivenessProbingChange: (listener) => livenessWatchdog.onProbingChange(listener),
    setLivenessForeground: (foreground) =>
      livenessWatchdog.setProfile(livenessProfileFor(foreground, RELAY_LIVENESS_PROFILES)),
    onStateChange(listener) {
      stateListeners.add(listener)
      return () => stateListeners.delete(listener)
    },
    notifyForeground: (reason) => {
      if (state === 'connected' && reason !== 'network-change') {
        livenessWatchdog.probeNow(livenessIdentity)
      }
    },
    close() {
      if (closed) {
        return
      }
      closed = true
      livenessWatchdog.stop(livenessIdentity)
      link.close()
      pending.rejectAll(new Error('Client closed'))
      streams.clear()
      publishState('disconnected')
    },
    getDialStage: () => dialStage.getDialStage(),
    onDialStageChange: (listener) => dialStage.onDialStageChange(listener),
    getDialTimings: () => dialStage.getTimings(),
    getAttachDeadlineAt: () => attachDeadlineAt,
    getResumeExpiresAt: () => resumeExpiresAt,
    getResumeConfirmation: () => resumeConfirmation,
    getFailure: () => failure
  }
  const livenessWatchdog = new RpcSessionLivenessWatchdog({
    transport: 'relay',
    idleProbeMs: RELAY_IDLE_PROBE_MS,
    probeTimeoutMs: RELAY_PROBE_TIMEOUT_MS,
    missedProbeLimit: RELAY_MISSED_PROBE_LIMIT,
    voluntaryProbeMinIntervalMs: RELAY_FOREGROUND_PROBE_MIN_INTERVAL_MS,
    sendProbe: () =>
      state === 'connected' &&
      sendFrame({ id: pending.nextId(), method: 'status.get', params: undefined }),
    onTimeout: (evidence) => {
      args.onLog?.({
        id: `relay-liveness-${logSessionId}-${++logSequence}`,
        ts: Date.now(),
        level: 'error',
        code: 'liveness-timeout',
        path: 'relay',
        message: 'Relay health check failed',
        detail: `${evidence.reason}; ${evidence.missedProbes}/${evidence.missedProbeLimit} probes missed; last authenticated activity ${evidence.lastInboundAgeMs}ms ago`
      })
    },
    terminate: () => fail(new Error('relay session liveness timeout'))
  })
  return client

  async function confirmResume(): Promise<void> {
    dialStage.advance('confirming')
    try {
      // Why: the capability advisory is one-way and independent of the resume
      // confirmation, so it rides the same round trip instead of a second one
      // after it (that second trip was a third of the confirm leg). The
      // confirmation frame still goes out first.
      const confirmation = sendRpc(
        'pairing.getEndpoints',
        { resumeConfirmReqId: args.resumeConfirmReqId },
        requestTimeoutMs,
        true
      )
      const capabilities = settleMobileRuntimeCapabilities((method, params) =>
        sendRpc(method, params, requestTimeoutMs, true)
      )
      capabilities.catch(() => undefined)
      const response = await confirmation
      if (!response.ok) {
        throw new Error(response.error.code)
      }
      const result = PairingGetEndpointsResultSchema.parse(response.result)
      if (!result.resumeConfirmation || result.relay?.relayHostId !== args.relay.relayHostId) {
        throw new Error('relay resume confirmation missing')
      }
      resumeConfirmation = result.resumeConfirmation
      resumeExpiresAt = result.resumeConfirmation.resumeExpiresAt
      // Why: an unanswered advisory must not keep a slow relay from ever reaching connected.
      await capabilities
      // A background cancellation or a direct winner may close this session
      // while the advisory settles. Never revive a socket that was retired.
      if (closed) {
        return
      }
      lastConnectedAt = Date.now()
      livenessWatchdog.start(livenessIdentity)
      dialStage.markConnected()
      publishState('connected')
    } catch (error) {
      fail(asError(error))
    }
  }

  function sendRpc(
    method: string,
    params: unknown,
    timeoutMs = requestTimeoutMs,
    beforeConnected = false
  ): Promise<RpcResponse> {
    if (closed || (!beforeConnected && state !== 'connected')) {
      return Promise.reject(new Error('relay session not connected'))
    }
    const id = pending.nextId()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.drop(id)
        // Why: the frame was written long ago — the desktop may have processed it.
        reject(markRpcDeliveryUnknown(new Error(`relay RPC timed out: ${method}`)))
      }, timeoutMs)
      pending.track(id, { resolve, reject, timer })
      if (!sendFrame({ id, method, params })) {
        clearTimeout(timer)
        pending.drop(id)
        reject(new Error('relay E2EE channel not ready'))
      }
    })
  }

  function sendFrame(request: { id: string; method: string; params?: unknown }): boolean {
    return link.sendText(JSON.stringify({ ...request, deviceToken: args.deviceToken }))
  }

  function handleText(plaintext: string): void {
    let value: unknown
    try {
      value = JSON.parse(plaintext)
    } catch {
      return
    }
    if (!isRpcResponse(value)) {
      return
    }
    if (pending.settle(value)) {
      return
    }
    streams.handleResponse(value)
  }

  function handleBinary(bytes: Uint8Array): void {
    streams.handleBinary(bytes)
  }

  function waitForConnected(timeoutMs = requestTimeoutMs): Promise<void> {
    return waitForRelaySessionConnected(
      { getState: () => state, isClosed: () => closed, onStateChange: client.onStateChange },
      timeoutMs
    )
  }

  function publishState(next: ConnectionState): void {
    if (state === next) {
      return
    }
    state = next
    for (const listener of stateListeners) {
      listener(next)
    }
  }

  function fail(error: Error): void {
    if (closed) {
      return
    }
    closed = true
    failure = error
    livenessWatchdog.stop(livenessIdentity)
    // Why: a closed session must not leave the host publishing into streams
    // nobody reads. Upstream #18926.
    streams.clear()
    link.close()
    pending.rejectAll(error)
    publishState(error instanceof MobileE2EEAuthenticationError ? 'auth-failed' : 'disconnected')
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
