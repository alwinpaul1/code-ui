import { useEffect, useLayoutEffect, useState } from 'react'
import {
  CLAUDE_TOKEN_TWEEN_IDLE,
  claudeFooterStats,
  tokenTweenSettled,
  tokenTweenValue,
  updateTokenTween,
  type ClaudeFooterLiveInput,
  type ClaudeFooterStats,
  type ClaudeThinkingBounds,
  type ClaudeTokenTween
} from './claude-working-footer-stats'

/**
 * The working footer's stats over time, as the Claude app keeps them (claude-working-footer-stats.ts
 * has the decompiled lines): the elapsed clock, the "thought for Ns" span after thinking stops, and
 * the token figure's count-up.
 *
 * The span is measured on the phone's clock: it opens when the footer's `thinking` turns on and
 * closes when it turns off while the turn is still open, as the app's `y6y` holds a start and turns
 * it into `a6y` bounds on its own clock. A new turn (another `turnStartedAt`) forgets the last span,
 * as the app's send clears it (`y6y.b`, rs8.java:1428).
 */

type SpanState = {
  turn: number | null
  openedAt: number | null
  last: ClaudeThinkingBounds | null
}

export type FooterClockState = {
  on: boolean
  thinking: boolean
  turn: number | null
  tokens: number | null
  span: SpanState
  tween: ClaudeTokenTween
}

/** The held state with no turn open. */
export const FOOTER_CLOCK_OFF: FooterClockState = {
  on: false,
  thinking: false,
  turn: null,
  tokens: null,
  span: { turn: null, openedAt: null, last: null },
  tween: CLAUDE_TOKEN_TWEEN_IDLE
}

/** The held state after the footer's input at `now`; the same object when nothing changed. */
export function stepFooterClock(prev: FooterClockState, live: ClaudeFooterLiveInput | null, now: number): FooterClockState {
  const on = live !== null
  const thinking = live?.thinking === true
  const turn = live?.turnStartedAt ?? null
  const tokens = live !== null && live.thinkingTokens !== null && live.thinkingTokens > 0 ? live.thinkingTokens : null
  if (prev.on === on && prev.thinking === thinking && prev.turn === turn && prev.tokens === tokens) {
    return prev
  }
  if (!on) {
    return FOOTER_CLOCK_OFF
  }
  let span = prev.span.turn === turn && prev.on ? prev.span : { turn, openedAt: null, last: null }
  if (thinking && span.openedAt === null) {
    span = { ...span, openedAt: now }
  } else if (!thinking && span.openedAt !== null) {
    span = { turn, openedAt: null, last: { startedAt: span.openedAt, endedAt: now, closedAt: now } }
  }
  return { on, thinking, turn, tokens, span, tween: updateTokenTween(prev.tween, now, tokens) }
}

export function useClaudeFooterStats(live: ClaudeFooterLiveInput | null): ClaudeFooterStats | null {
  const [held, setHeld] = useState<FooterClockState>(FOOTER_CLOCK_OFF)
  const [now, setNow] = useState(() => Date.now())
  const on = live !== null
  const thinking = live?.thinking === true
  const turn = live?.turnStartedAt ?? null
  const tokens = live?.thinkingTokens ?? null
  // Stepped in a layout effect, which re-renders before the frame is painted: a span that just
  // closed draws "thought for" in its first painted frame, not one frame of the verb.
  useLayoutEffect(() => {
    const at = Date.now()
    const input = on ? { turnStartedAt: turn, thinking, thinkingTokens: tokens } : null
    setHeld((prev) => stepFooterClock(prev, input, at))
    setNow(at)
  }, [on, thinking, turn, tokens])
  const counting = held.tween.target !== null && !tokenTweenSettled(held.tween, now)
  useEffect(() => {
    if (!on) {
      return undefined
    }
    setNow(Date.now())
    // xrd.java: 100 ms while the count-up runs, 1000 ms once it has its figure.
    const timer = setInterval(() => setNow(Date.now()), counting ? 100 : 1_000)
    return () => clearInterval(timer)
  }, [on, counting])
  if (!live) {
    return null
  }
  return claudeFooterStats(live, now, { lastThinking: held.span.last, shownTokens: tokenTweenValue(held.tween, now) })
}
