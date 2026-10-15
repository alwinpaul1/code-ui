import { CLAUDE_FOOTER_SEPARATOR } from './claude-working-footer-spec'

// The stats the Claude app's working footer draws before its count, and the status phrase after
// it: "15s · 2 running tasks · still thinking…" (com.anthropic.claude 1.261009.20, jadx, read
// 2026-10-15; the user's screenshot of the app the same day showed exactly that line).
//
//   builder        zs20.java:886-1046  `x(tokens, turnStart, thinking, lastThinking, …)` makes the
//                                      line's `Stats(stats, status)`, or null
//   elapsed        zs20.java:930-937   whole seconds since the turn started, never below 0; 0 when
//                                      no start is known
//   format         zs20.java:595-607   under a minute `ccr_thinking_elapsed_seconds` "%1$ds";
//                                      from a minute `ccr_thinking_elapsed_minutes_seconds`
//                                      "%1$dm %2$ds" (no hours, no zero padding)
//   status         zs20.java:939-985   while thinking, by those same elapsed seconds: under 15
//                                      "thinking…", under 30 "still thinking…", under 45 "thinking
//                                      more…", under 60 "thinking some more…", else "almost done
//                                      thinking…" (`ccr_thinking_status_*`)
//   tokens         zs20.java:1018-1040 `NumberFormat.getIntegerInstance()` then the plural
//                                      `ccr_thinking_token_count` "%1$s token" / "%1$s tokens"
//   stats          zs20.java:1041-1045 elapsed + " · " + tokens when there are tokens, else elapsed
//                                      alone when there is a status; with neither, no Stats: the
//                                      line falls back to its cycling verb (au8.java:91)
//   drawing        nl7.java:188-224    stats in `pl7.Q` (the muted body colour), then the count's
//                                      " · " in `pl7.Q` and the count in link blue `ad5.C0()`
//                                      (nl7.java:257-290), then " · " + status in `pl7.Q`, one line
//
// Not drawn: the app's "thought for Ns" status (`ccr_thinking_status_thought_for`), shown for 2 s
// after a thinking span ends. Its span comes from state jadx could not decompile (`y6y.n`), and a
// span measured here from event times would be a guess.

export const CLAUDE_THINKING_STATUS = [
  'thinking…',
  'still thinking…',
  'thinking more…',
  'thinking some more…',
  'almost done thinking…'
] as const

/** `zs20.n`: "15s", "1m 5s". */
export function formatClaudeElapsed(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(whole / 60)
  const rest = whole % 60
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`
}

/** The thinking phrase at `seconds` into the turn (zs20.java:939-985). */
export function claudeThinkingStatus(seconds: number): string {
  if (seconds >= 60) {
    return CLAUDE_THINKING_STATUS[4]
  }
  if (seconds >= 45) {
    return CLAUDE_THINKING_STATUS[3]
  }
  if (seconds >= 30) {
    return CLAUDE_THINKING_STATUS[2]
  }
  if (seconds >= 15) {
    return CLAUDE_THINKING_STATUS[1]
  }
  return CLAUDE_THINKING_STATUS[0]
}

// A fixed locale: the app's figure has grouping, and the phone's own locale would put a different
// separator in the same line on two phones (the `toLocale*(undefined` defect, 2026-08-06).
const TOKENS = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

/** `ccr_thinking_token_count`: "1 token", "1,234 tokens". */
export function formatClaudeTokenCount(tokens: number): string {
  return `${TOKENS.format(tokens)} ${tokens === 1 ? 'token' : 'tokens'}`
}

export type ClaudeFooterLiveInput = {
  /** Epoch ms the turn started, or null when not known. */
  turnStartedAt: number | null
  thinking: boolean
  thinkingTokens: number | null
}

export type ClaudeFooterStats = {
  /** "15s", or "15s · 1,234 tokens". */
  stats: string
  /** "still thinking…", or null. */
  status: string | null
}

/** The app's `Stats(stats, status)` for a working line, or null when it has neither tokens nor a
 *  status (the line then draws its cycling verb). */
export function claudeFooterStats(input: ClaudeFooterLiveInput, now: number): ClaudeFooterStats | null {
  const elapsed = input.turnStartedAt === null ? 0 : Math.max(0, Math.floor((now - input.turnStartedAt) / 1000))
  const status = input.thinking ? claudeThinkingStatus(elapsed) : null
  const tokens = input.thinkingTokens !== null && input.thinkingTokens > 0 ? formatClaudeTokenCount(input.thinkingTokens) : null
  const time = formatClaudeElapsed(elapsed)
  if (tokens !== null) {
    return { stats: `${time}${CLAUDE_FOOTER_SEPARATOR}${tokens}`, status }
  }
  return status !== null ? { stats: time, status } : null
}
