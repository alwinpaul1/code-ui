import type { RelayRecoveryLog } from './mobile-relay-recovery-log'
import type { ScheduleTimer } from './timer-scheduler'

type TimerDependencies = {
  now: () => number
  setTimer: ScheduleTimer
  clearTimer: typeof clearTimeout
}

/**
 * Records when the timer armed through these dependencies is due. The relay
 * reconnect controller owns exactly one timer slot, so giving it these lets a
 * deferred recovery say when it tries next without the controller keeping the
 * time itself.
 */
export function trackTimerDueTime<T extends TimerDependencies>(
  dependencies: T
): { dependencies: T; dueAt: () => number | null } {
  let due: { handle: ReturnType<typeof setTimeout>; at: number } | null = null
  const setTimer: ScheduleTimer = (handler, ms) => {
    const handle = dependencies.setTimer(() => {
      if (due?.handle === handle) {
        due = null
      }
      handler()
    }, ms)
    due = { handle, at: dependencies.now() + ms }
    return handle
  }
  const clearTimer = ((handle: ReturnType<typeof setTimeout>) => {
    if (due?.handle === handle) {
      due = null
    }
    dependencies.clearTimer(handle)
  }) as typeof clearTimeout
  return { dependencies: { ...dependencies, setTimer, clearTimer }, dueAt: () => due?.at ?? null }
}

/**
 * Logs a deferred relay recovery once per window (one cooldown, or one gate
 * reprobe), naming what it waits on and when it tries next. Logged on every
 * deferred call, "recovery deferred by cooldown or gate" followed nearly every
 * other line of a Pixel's diagnostics (2026-09-27) and said neither.
 */
export class RelayRecoveryDeferralLog {
  private logged: string | null = null

  constructor(
    private readonly log: RelayRecoveryLog,
    private readonly now: () => number,
    private readonly nextAttemptAt: () => number | null
  ) {}

  note(reason: string): void {
    const next = this.nextAttemptAt()
    const window = `${reason}@${next ?? 'none'}`
    if (window === this.logged) {
      return
    }
    this.logged = window
    const inSeconds = next === null ? 0 : Math.max(0, Math.round((next - this.now()) / 1000))
    this.log(
      `recovery deferred by ${reason}`,
      next === null
        ? 'no retry armed'
        : `next attempt at ${new Date(next).toISOString()} (in ${inSeconds}s)`
    )
  }

  /** Recovery went ahead: the next deferral opens a new window. */
  proceeded(): void {
    this.logged = null
  }
}
