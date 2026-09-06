import type { StableLogicalRpcClient } from './stable-logical-rpc-client'

// Race relay alongside an unauthenticated direct dial on the next event-loop
// turn. A fixed LAN head start also delays cellular and stale Wi-Fi endpoints;
// the existing migration guards let the first authenticated connection win.
export const DIRECT_DIAL_GRACE_MS = 0

type DirectGraceTimerDependencies = {
  setTimer: typeof setTimeout
  clearTimer: typeof clearTimeout
}

// One-shot timer that releases the relay dial when the direct dial has not
// authenticated within the grace. The supervisor arms it at start and on
// foreground restore, and clears it on connect, background, and stop.
export class MobileRelayDirectGraceTimer {
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly dependencies: DirectGraceTimerDependencies,
    private readonly logical: StableLogicalRpcClient,
    private readonly dialRelay: () => void,
    // Why: a direct endpoint that has failed every dial this session (Tailscale
    // off on the phone, a stale pairing address) earns no head start; the relay
    // race begins immediately and the user is connected without the initial head start.
    private readonly graceMs: () => number = () => DIRECT_DIAL_GRACE_MS
  ) {}

  // No-op unless the direct dial is still unauthenticated, so a healthy LAN and
  // an already-failed direct path (recovery owns that) never open a relay socket.
  arm(): void {
    const state = this.logical.getState()
    if (this.timer || (state !== 'connecting' && state !== 'handshaking')) {
      return
    }
    this.timer = this.dependencies.setTimer(() => {
      this.timer = null
      if (this.logical.getState() !== 'connected') {
        this.dialRelay()
      }
    }, Math.max(0, this.graceMs()))
  }

  clear(): void {
    if (this.timer) {
      this.dependencies.clearTimer(this.timer)
      this.timer = null
    }
  }
}
