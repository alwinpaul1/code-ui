import { appForegroundSince } from './app-foreground-clock'

/**
 * One-line timing marks for opening a session, so a slow open names its gap.
 *
 * Why: on 2026-10-17 a chat came up about 4.5 s after the app returned to the
 * front, and the log held nothing between the bundle's start and the chat's
 * first snapshot, so nobody could say whether the time went to the screen, the
 * tab list, the terminals or the chat read. Each mark says how long after the
 * JS bundle started it happened and, once the app has been away, how long after
 * it came back. grep logcat for `[open-timing]`.
 *
 * Imported first by index.ts, so its clock starts with the bundle. Counts and
 * short ids only: no message text, paths or credentials.
 */
const JS_STARTED_AT = Date.now()

/** `+<ms> ms since JS start`, plus `, +<ms> ms since back in front` once the app has been away. */
export function openTimingClock(now = Date.now(), foregroundSince = appForegroundSince()): string {
  const sinceStart = `+${Math.max(0, now - JS_STARTED_AT)} ms since JS start`
  if (foregroundSince === null) {
    return `${sinceStart}, app in background`
  }
  if (!Number.isFinite(foregroundSince)) {
    return sinceStart
  }
  return `${sinceStart}, +${Math.max(0, now - foregroundSince)} ms since back in front`
}

/** `[open-timing] <mark> (<detail>) at <clock>`. */
export function formatOpenTiming(mark: string, detail: string | undefined, clock: string): string {
  return `[open-timing] ${mark}${detail ? ` (${detail})` : ''} at ${clock}`
}

export function logOpenTiming(mark: string, detail?: string): void {
  console.log(formatOpenTiming(mark, detail, openTimingClock()))
}
