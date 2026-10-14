import type { ContextBreakdown } from './claude-context-report'
import type { TerminalHudObservation } from './mobile-terminal-hud-parse'

/**
 * The held `/context` table rides on the context reading, as the usage windows do
 * (`attachHudRateLimits`): the sheet that draws it opens from the ring, and the ring exists only
 * with a context figure. With none there is no sheet, so the table waits for the next reading.
 * The table is held, so it is attached again on every reading until the session changes.
 */
export function attachContextBreakdown(
  screen: TerminalHudObservation | null,
  breakdown: ContextBreakdown | null
): TerminalHudObservation | null {
  if (!screen || !screen.context || breakdown === null) {
    return screen
  }
  return { ...screen, context: { ...screen.context, breakdown } }
}
