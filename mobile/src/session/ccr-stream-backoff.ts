import { CCR_STREAM_IDLE_STABLE_MS, CCR_STREAM_LOST_RETRY_MS, CCR_STREAM_RECONNECT_MS, CCR_STREAM_STABLE_MS } from './ccr-session-link-types'

/**
 * A Claude session stream's reconnect back-off (ccr-session-link.ts): the waits before each redial,
 * as the Claude app's stream does (CCR_STREAM_RECONNECT_MS), and when a connection was good enough
 * to start them over.
 */
export class CcrStreamBackoff {
  private reconnects = 0
  /** Retries of a lost stream since the back-off last started over (CCR_STREAM_LOST_RETRY_MS). */
  private lostRetries = 0

  /** Redials made since the back-off last started over. */
  get count(): number {
    return this.reconnects
  }

  reset(): void {
    this.reconnects = 0
    this.lostRetries = 0
  }

  /** A connection ended after `upMs` (null when it never opened). It starts the back-off over when
   *  it moved the transcript on AND stayed up CCR_STREAM_STABLE_MS, or stayed up
   *  CCR_STREAM_IDLE_STABLE_MS with nothing new (an idle session). Any frame was enough once: a
   *  server that sent one `session_update` and closed was redialled every second for ever; then
   *  only a new event was, so an idle stream dropped five times over hours was lost (reviews
   *  2026-10-15). */
  settle(upMs: number | null, movedOn: boolean): void {
    if (upMs !== null && (upMs >= CCR_STREAM_IDLE_STABLE_MS || (movedOn && upMs >= CCR_STREAM_STABLE_MS))) {
      this.reset()
    }
  }

  /** The wait before the next redial, counted; null once every wait is spent (the stream is lost). */
  next(): number | null {
    const wait = CCR_STREAM_RECONNECT_MS[this.reconnects]
    if (wait === undefined) {
      return null
    }
    this.reconnects += 1
    return wait
  }

  /** Once every wait is spent: the wait before the next retry of the lost stream, counted; null
   *  once those are spent too (it stays lost until a reset). */
  nextLostRetry(): number | null {
    const wait = CCR_STREAM_LOST_RETRY_MS[this.lostRetries]
    if (wait === undefined) {
      return null
    }
    this.lostRetries += 1
    return wait
  }
}
