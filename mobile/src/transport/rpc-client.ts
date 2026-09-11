import type { BrowserScreencastFrame } from './browser-screencast-protocol'
import { DirectRpcClient } from './direct-rpc-client'
import type {
  ConnectionLogSink,
  ConnectionState,
  ForegroundNudgeReason,
  RpcResponse
} from './types'

export type SendRequestOptions = {
  timeoutMs?: number
  /** Include the connect wait in the caller's timeout budget. */
  budgetSpansConnect?: boolean
  /** Reject instead of replaying the request after reconnect. */
  failWhenDisconnected?: boolean
}

type SubscribeOptions = {
  onBinaryFrame?: (frame: BrowserScreencastFrame) => void
}

type StreamingListener = (result: unknown) => void

export type RpcClient = {
  sendRequest: (
    method: string,
    params?: unknown,
    options?: SendRequestOptions
  ) => Promise<RpcResponse>
  subscribe: (
    method: string,
    params: unknown,
    onData: StreamingListener,
    options?: SubscribeOptions
  ) => () => void
  updateTerminalSubscriptionViewport: (
    terminal: string,
    viewport: { cols: number; rows: number }
  ) => void
  getState: () => ConnectionState
  getReconnectAttempt: () => number
  getLastConnectedAt: () => number | null
  getLastInboundAt?: () => number | null
  /** A liveness probe is out and unanswered; the header must not claim connected. */
  isLivenessProbing?: () => boolean
  onLivenessProbingChange?: (listener: (probing: boolean) => void) => () => void
  /** Foregrounded, the liveness leash is shorter: a dead socket is noticed in
   *  seconds, not the 38 s the background economy tolerates. */
  setLivenessForeground?: (foreground: boolean) => void
  onStateChange: (listener: (state: ConnectionState) => void) => () => void
  notifyForeground: (reason?: ForegroundNudgeReason) => void
  close: () => void
}

export type ConnectOptions = {
  onStateChange?: (state: ConnectionState) => void
  onLog?: ConnectionLogSink
  /** One socket to establish. A socket that closes before it authenticates
   *  ends the client ('disconnected') instead of starting the reconnect
   *  ladder. Once authenticated the client reconnects as usual — a probe
   *  that wins is migrated in as the live connection, so it has to. */
  dialOnce?: boolean
}

export function connect(
  endpoint: string,
  deviceToken: string,
  serverPublicKeyB64: string,
  optionsOrLegacy?: ConnectOptions | ((state: ConnectionState) => void)
): RpcClient {
  const options: ConnectOptions =
    typeof optionsOrLegacy === 'function'
      ? { onStateChange: optionsOrLegacy }
      : (optionsOrLegacy ?? {})
  return new DirectRpcClient(endpoint, deviceToken, serverPublicKeyB64, options)
}
