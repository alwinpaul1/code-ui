const RECONNECT_DELAYS = [500, 1000, 2000, 4000, 8000, 15_000, 30_000, 60_000]
export const RPC_RECONNECT_ATTEMPT_LIMIT = 12
const TRICKLE_RECONNECT_DELAY_MS = 90_000

type ReconnectScheduleOptions = {
  openConnection: () => void
  rejectConnectWaiters: (reason: string) => void
  emitLog: (message: string, detail: string) => void
  // See ConnectOptions.dialOnce.
  dialOnce?: boolean
}

export class RpcClientReconnectSchedule {
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private authenticatedOnce = false

  constructor(private readonly options: ReconnectScheduleOptions) {}

  getAttempt(): number {
    return this.attempt
  }

  authenticated(): void {
    this.attempt = 0
    this.authenticatedOnce = true
  }

  /** Whether a socket close is followed by another dial. A dial-once client
   *  that has never authenticated is a probe: its first refusal is its verdict.
   *  Measured on a Galaxy S23 (2026-09-09): probes that DID retry sat out their
   *  whole 12 s budget on a refused address, opening a socket at 500 ms, 1 s,
   *  2 s and 4 s, two log lines each, on every known address, all day. */
  willRetry(): boolean {
    return !this.options.dialOnce || this.authenticatedOnce
  }

  /** The state a closed socket leaves the client in. Callers publish this
   *  BEFORE calling schedule(), so it has to come from the same answer. */
  stateAfterClose(): 'reconnecting' | 'disconnected' {
    return this.willRetry() ? 'reconnecting' : 'disconnected'
  }

  schedule(): void {
    if (!this.willRetry()) {
      // 'disconnected' has already rejected the connect waiters; nothing to arm.
      return
    }
    const trickle = this.attempt >= RPC_RECONNECT_ATTEMPT_LIMIT
    let delayMs: number
    if (trickle) {
      delayMs = TRICKLE_RECONNECT_DELAY_MS
      this.options.rejectConnectWaiters('Connection retry limit reached')
    } else {
      delayMs = RECONNECT_DELAYS[Math.min(this.attempt, RECONNECT_DELAYS.length - 1)]!
      this.attempt++
    }
    console.log('[net] scheduleReconnect', {
      delayMs,
      attempt: this.attempt,
      trickle
    })
    this.options.emitLog(
      `Reconnect scheduled in ${delayMs}ms`,
      trickle ? `Attempt ${this.attempt} (slow retry)` : `Attempt ${this.attempt}`
    )
    this.timer = setTimeout(() => {
      this.timer = null
      this.options.openConnection()
    }, delayMs)
  }

  redialNow(resetAttempts: boolean): void {
    this.cancel()
    if (resetAttempts) {
      this.attempt = 0
    }
    this.options.openConnection()
  }

  hasTimer(): boolean {
    return this.timer !== null
  }

  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}
