import type { BrowserScreencastFrame } from './browser-screencast-protocol'
import { DirectRpcClient } from './direct-rpc-client'
import type { ConnectionLogSink, ConnectionState, ForegroundNudgeReason } from './types'
import type { UnvalidatedRpcRequestPort } from './unvalidated-rpc-request-port'

// Re-export shim: the options type moved to the port module with the sender it belongs to,
// and re-exporting is what keeps that move from touching every importer.
export type { SendRequestOptions } from './unvalidated-rpc-request-port'

type SubscribeOptions = {
  onBinaryFrame?: (frame: BrowserScreencastFrame) => void
}

type StreamingListener = (result: unknown) => void

// Still structurally carries the raw sender, so holding a client is still holding the port —
// which is why the boundary is inventoried rather than merely declared.
export type RpcClient = UnvalidatedRpcRequestPort & {
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
