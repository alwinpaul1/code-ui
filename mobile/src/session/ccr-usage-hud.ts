import { shortTokenLabel } from './hud-agent-status-fields'
import type { RateLimitWindowReading } from './hud-rate-limit-notice'
import type { CcrUsageReading } from './ccr-session-usage'
import type { TerminalHudContextWindow } from './mobile-terminal-hud-parse'

/**
 * Today's ring, usage rows and token count, with Anthropic's per-tab figures laid under them.
 *
 * Precedence, per figure:
 *  - CONTEXT: what this session's own terminal states (a live beacon, the badge, the host's status)
 *    wins when present. Only then the matched session's events from Anthropic: a ring when the
 *    session stated its window, else the tokens alone (no percentage, no invented denominator).
 *  - USAGE ROWS: a Claude beacon decides alone, as before (`hudRateLimitWindows`). Otherwise a tab
 *    MATCHED to an Anthropic account shows that account's windows and nothing else: when they could
 *    not be read it shows no rows, never the host's feed, which is whichever login Orca holds and may
 *    be the other account. A tab not matched to any account keeps the host's feed, as it always had.
 */

export type CcrHudInput = {
  context: TerminalHudContextWindow | null
  limits: readonly RateLimitWindowReading[]
  usedTokens: number | null
}

export function applyCcrUsageToHud(
  today: CcrHudInput,
  args: {
    /** The fresh reading for this tab's matched session and account, or null. */
    reading: CcrUsageReading | null
    /** The tab is matched to an account (even when no reading is fresh). */
    matchedAccount: boolean
    /** A live Claude beacon is believed for this session: it decides the usage rows alone. */
    beaconDecidesLimits: boolean
  }
): CcrHudInput {
  const { reading, matchedAccount, beaconDecidesLimits } = args
  const accountRows: RateLimitWindowReading[] | null = beaconDecidesLimits || !matchedAccount ? null : (reading?.limits ?? []).map((row) => ({ ...row }))
  let context = today.context
  let usedTokens = today.usedTokens
  if (accountRows !== null && context) {
    // The sheet draws the windows on the context reading: the account's, or none.
    const { limits: _host, ...rest } = context
    context = accountRows.length > 0 ? { ...rest, limits: accountRows } : rest
  }
  if (!context && reading?.context) {
    const { usedTokens: used, windowTokens: window } = reading.context
    if (window !== null && window > 0) {
      context = {
        usedPercent: Math.max(0, Math.min(100, Math.round((used / window) * 100))),
        usedLabel: shortTokenLabel(used),
        windowLabel: shortTokenLabel(window),
        ...(accountRows !== null && accountRows.length > 0 ? { limits: accountRows } : {})
      }
    } else if (usedTokens === null) {
      usedTokens = used
    }
  }
  return { context, limits: accountRows ?? [...today.limits], usedTokens }
}
