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
//   thought for    zs20.java:957-965   when NOT thinking and the last thinking span (`a6y`
//                                      ThinkingBlockBounds: startedAt, endedAt, closedAt) closed
//                                      under 2000 ms ago: "thought for %1$s"
//                                      (`ccr_thinking_status_thought_for`), the span in whole
//                                      seconds, at least 1, written by `zs20.n` (:996)
//   count-up       g8y.java            the token figure is not drawn as it arrives: the first one
//                                      counts up from 0 over 1200 ms; a rise runs from the figure
//                                      reached so far over the time since the previous figure,
//                                      held to 300..3000 ms; a fall jumps; no figure resets it.
//                                      Drawn clamped to 1..the real figure (zs20.java:1014-1017).
//                                      The clock ticks every 100 ms while it runs, else every
//                                      1000 ms (xrd.java default case)
//
// The span's bounds are set in code jadx could not decompile (`y6y.n`). The app measures them on
// its own clock (`cvb`, the same clock the d230 path builds an `a6y` from); here they are the
// phone's clock at the moments the footer's `thinking` turns on and off
// (use-claude-footer-stats.ts), the same kind of measurement.

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

/** `a6y` ThinkingBlockBounds, epoch ms. */
export type ClaudeThinkingBounds = { startedAt: number; endedAt: number; closedAt: number }

/** How long "thought for Ns" stays after the span closed (zs20.java:957). */
export const CLAUDE_THOUGHT_FOR_MS = 2_000

/** "thought for 8s" while the span closed under 2 s ago, else null (zs20.java:957-965, :996). */
export function claudeThoughtFor(bounds: ClaudeThinkingBounds | null, now: number): string | null {
  if (bounds === null || now >= bounds.closedAt + CLAUDE_THOUGHT_FOR_MS) {
    return null
  }
  const seconds = Math.max(1, Math.floor((bounds.endedAt - bounds.startedAt) / 1000))
  return `thought for ${formatClaudeElapsed(seconds)}`
}

export type ClaudeFooterView = {
  /** The last closed thinking span of this turn, or null. */
  lastThinking?: ClaudeThinkingBounds | null
  /** Where the token count-up stands (`tokenTweenValue`); absent draws the real figure. */
  shownTokens?: number | null
}

/** The app's `Stats(stats, status)` for a working line, or null when it has neither tokens nor a
 *  status (the line then draws its cycling verb). */
export function claudeFooterStats(input: ClaudeFooterLiveInput, now: number, view: ClaudeFooterView = {}): ClaudeFooterStats | null {
  const elapsed = input.turnStartedAt === null ? 0 : Math.max(0, Math.floor((now - input.turnStartedAt) / 1000))
  const status = input.thinking ? claudeThinkingStatus(elapsed) : claudeThoughtFor(view.lastThinking ?? null, now)
  const real = input.thinkingTokens !== null && input.thinkingTokens > 0 ? input.thinkingTokens : null
  // zs20.java:1017: the count-up's figure, held to 1..the real one.
  const shown = real === null ? null : Math.min(real, Math.max(1, view.shownTokens ?? real))
  const tokens = shown === null ? null : formatClaudeTokenCount(shown)
  const time = formatClaudeElapsed(elapsed)
  if (tokens !== null) {
    return { stats: `${time}${CLAUDE_FOOTER_SEPARATOR}${tokens}`, status }
  }
  return status !== null ? { stats: time, status } : null
}

/** `g8y`: the token count-up. `target` the real figure (`a`), `from` where the run starts (`b`),
 *  `at` when it started (`c`), `durationMs` its length (`d`), `lastAt` when the previous figure
 *  came (`e`). */
export type ClaudeTokenTween = {
  target: number | null
  from: number
  at: number
  durationMs: number
  lastAt: number | null
}

export const CLAUDE_TOKEN_TWEEN_IDLE: ClaudeTokenTween = { target: null, from: 0, at: 0, durationMs: 0, lastAt: null }

/** `g8y.b`: the figure the count-up has reached at `now`, or null with no figure. */
export function tokenTweenValue(tween: ClaudeTokenTween, now: number): number | null {
  if (tween.target === null) {
    return null
  }
  if (tween.durationMs <= 0) {
    return tween.target
  }
  const progress = Math.min(1, Math.max(0, (now - tween.at) / tween.durationMs))
  return Math.trunc((tween.target - tween.from) * progress + tween.from)
}

/** Whether the count-up has reached its figure (the app's clock then slows to 1 s). */
export function tokenTweenSettled(tween: ClaudeTokenTween, now: number): boolean {
  return tokenTweenValue(tween, now) === tween.target
}

/** `g8y.a`: a new real figure (or none) at `now`. The same figure returns `tween` itself. */
export function updateTokenTween(tween: ClaudeTokenTween, now: number, target: number | null): ClaudeTokenTween {
  if (target === null) {
    return tween.target === null ? tween : { ...tween, target: null, durationMs: 0, lastAt: null }
  }
  if (tween.target === target) {
    return tween
  }
  if (tween.target === null) {
    return { target, from: 0, at: now, durationMs: 1_200, lastAt: now }
  }
  if (target < tween.target) {
    return { ...tween, target, durationMs: 0, lastAt: now }
  }
  const gap = tween.lastAt === null ? 3_000 : now - tween.lastAt
  return {
    target,
    from: tokenTweenValue(tween, now) ?? target,
    at: now,
    durationMs: Math.min(3_000, Math.max(300, gap)),
    lastAt: now
  }
}
