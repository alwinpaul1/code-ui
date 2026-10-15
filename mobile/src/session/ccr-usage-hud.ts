import { shortTokenLabel } from './hud-agent-status-fields'
import type { RateLimitWindowReading } from './hud-rate-limit-notice'
import type { CcrUsageReading } from './ccr-session-usage'
import type { CcrContextUsageAnswer } from './ccr-context-usage'
import { formatTokens } from './context-card-model'
import type { TerminalHudContextWindow } from './mobile-terminal-hud-parse'

/**
 * Today's ring, usage rows and token count, with Anthropic's per-tab figures laid under them.
 *
 * Precedence, per figure:
 *  - CONTEXT: first the session's own answer to `get_context_usage` for the current turn
 *    (ccr-context-usage.ts, use-ccr-usage-sheet.ts), as the Claude app's ring reads it (taa.a):
 *    the agent saying now what it holds. Then what this session's own terminal states (a live beacon, the badge, the host's status)
 *    wins when present. Only then the matched session's events from Anthropic: a ring when the
 *    session stated its window, else the tokens alone (no percentage, no invented denominator).
 *  - USAGE ROWS: a Claude beacon decides alone, as before (`hudRateLimitWindows`). Otherwise a tab
 *    MATCHED to an Anthropic account shows that account's windows and nothing else: when they could
 *    not be read it shows no rows, never the host's feed, which is whichever login Orca holds and may
 *    be the other account. A tab whose account is not known (no match, its config dir unbound) keeps
 *    the host's feed only while at most one account is signed in; with several it shows no rows.
 *    Its account is known through its Claude config dir before the match lands (ccr-session-usage.ts).
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
    /** The tab's account is known, matched or through its config dir (even when no reading is fresh). */
    matchedAccount: boolean
    /** With no account known: the host's feed may stand in (at most one account is signed in). */
    hostFeedAllowed: boolean
    /** A live Claude beacon is believed for this session: it decides the usage rows alone. */
    beaconDecidesLimits: boolean
    /** The session's answer to `get_context_usage` for the current turn, or null. */
    live?: CcrContextUsageAnswer | null
  }
): CcrHudInput {
  const { reading, matchedAccount, hostFeedAllowed, beaconDecidesLimits } = args
  const accountRows: RateLimitWindowReading[] | null = beaconDecidesLimits || (!matchedAccount && hostFeedAllowed) ? null : (matchedAccount ? (reading?.limits ?? []) : []).map((row) => ({ ...row }))
  let context = today.context
  let usedTokens = today.usedTokens
  if (accountRows !== null && context) {
    // The sheet draws the windows on the context reading: the account's, or none.
    const { limits: _host, ...rest } = context
    context = accountRows.length > 0 ? { ...rest, limits: accountRows } : rest
  }
  if (args.live) {
    const { usedTokens: used, windowTokens: window, percent } = args.live
    const figure = { usedPercent: percent, usedLabel: formatTokens(used), windowLabel: formatTokens(window) }
    context = context
      ? { ...context, ...figure }
      : { ...figure, ...(accountRows !== null && accountRows.length > 0 ? { limits: accountRows } : {}) }
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
