import type { AccountsSnapshot, ProviderRateLimits } from '../components/accounts-snapshot'
import type { TerminalHudContextWindow, TerminalHudObservation } from './mobile-terminal-hud-parse'

/** One row per usage window the host reports, in the order the sheet draws them. */
export function hudLimitsFromRateLimits(
  limits: ProviderRateLimits | null
): NonNullable<TerminalHudContextWindow['limits']> {
  if (!limits) {
    return []
  }
  const rows: NonNullable<TerminalHudContextWindow['limits']>[number][] = []
  const windows: [string, ProviderRateLimits['session']][] = [
    ['Session', limits.session],
    ['Weekly', limits.weekly],
    ['Fable', limits.fableWeekly ?? null]
  ]
  for (const [name, window] of windows) {
    if (window) {
      rows.push({
        name,
        usedPercent: window.usedPercent,
        windowMinutes: window.windowMinutes,
        // The host stamps epoch milliseconds; the sheet's clock is seconds.
        resetsAt: window.resetsAt === null ? null : Math.floor(window.resetsAt / 1000)
      })
    }
  }
  return rows
}

export function hudRateLimitsForAgent(
  snapshot: AccountsSnapshot | null,
  agent: string | null
): ProviderRateLimits | null {
  if (!snapshot) {
    return null
  }
  if (agent === 'claude') {
    return snapshot.rateLimits.claude
  }
  if (agent === 'codex') {
    return snapshot.rateLimits.codex
  }
  return null
}

/**
 * The HUD reads two zero-setup sources: the agent's own screen for model,
 * effort, context and permission mode, and the host's `accounts.subscribe`
 * for rate-limit windows. Neither opens a terminal on the host. The windows
 * ride on the context reading so the context sheet can draw them; with no
 * context on screen there is no sheet, so they wait for the next reading.
 */
export function attachHudRateLimits(
  screen: TerminalHudObservation | null,
  limits: ProviderRateLimits | null
): TerminalHudObservation | null {
  if (!screen || !screen.context) {
    return screen
  }
  const rows = hudLimitsFromRateLimits(limits)
  if (rows.length === 0) {
    return screen
  }
  return { ...screen, context: { ...screen.context, limits: rows } }
}
