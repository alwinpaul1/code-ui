import type { ScheduleTimer } from '../transport/timer-scheduler'
import type { ConnectionLogEntry } from '../transport/types'

/** How often the detector ticks. Cheap: one timer, no I/O. */
export const APP_PAUSE_TICK_MS = 60_000

/** A tick this much later than due is a pause, not scheduling jitter. */
export const APP_PAUSE_THRESHOLD_MS = 5 * 60_000

type AppPauseDetectorDependencies = {
  now: () => number
  setTimer: ScheduleTimer
  clearTimer: typeof clearTimeout
  /** `from` is the last tick that ran on time, `to` the one that ran late. */
  onPause: (pause: { from: number; to: number }) => void
}

/**
 * Notices that no JavaScript ran for a while, and says so.
 *
 * Why it exists: on 2026-09-23 a report showed a relay drop at 12:14, one
 * 4404 dial at 12:19, and then nothing until 15:19. The recovery code redials
 * a 4404 every 5–15 s (driven through the same sequence in a test), so three
 * hours without one logged retry meant no timer ran at all. Android had paused
 * the app, and a paused app neither reconnects nor delivers a notification.
 * The log could not say so: a pause writes nothing, and silence reads the same
 * as a healthy link. This is the line that silence was missing.
 */
export class AppPauseDetector {
  private timer: ReturnType<typeof setTimeout> | null = null
  private lastTickAt: number | null = null

  constructor(private readonly dependencies: AppPauseDetectorDependencies) {}

  start(): void {
    if (this.timer !== null) {
      return
    }
    this.lastTickAt = this.dependencies.now()
    this.schedule()
  }

  stop(): void {
    if (this.timer !== null) {
      this.dependencies.clearTimer(this.timer)
      this.timer = null
    }
    this.lastTickAt = null
  }

  private schedule(): void {
    this.timer = this.dependencies.setTimer(() => this.tick(), APP_PAUSE_TICK_MS)
  }

  private tick(): void {
    const now = this.dependencies.now()
    const from = this.lastTickAt ?? now
    this.lastTickAt = now
    // Rescheduled first, so a reporter that throws cannot end the detector.
    this.schedule()
    if (now - from - APP_PAUSE_TICK_MS > APP_PAUSE_THRESHOLD_MS) {
      this.dependencies.onPause({ from, to: now })
    }
  }
}

/**
 * The line a pause leaves in each host's connection log. The two facts after
 * the duration separate the causes: with the service not running, the app was
 * merely in the background with nothing keeping it awake; with it running and
 * the battery optimised, Android paused a foreground service anyway. Both are
 * read when the app wakes, not during the pause, and the line says so.
 */
export function appPauseLogEntry(
  pause: { from: number; to: number },
  background: { serviceRunning: boolean; unrestricted: boolean }
): ConnectionLogEntry {
  return {
    id: `app-paused-${pause.to}`,
    ts: pause.to,
    level: 'warn',
    code: 'app-paused',
    message: 'Android paused the app',
    detail:
      `Nothing ran for ${formatPause(pause.to - pause.from)} (since ${new Date(pause.from).toISOString()}): ` +
      `no reconnects, no notifications. On waking: background service ${background.serviceRunning ? 'running' : 'not running'}, ` +
      `battery ${background.unrestricted ? 'unrestricted' : 'optimised'}`
  }
}

function formatPause(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
