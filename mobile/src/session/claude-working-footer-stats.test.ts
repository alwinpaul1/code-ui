import { describe, expect, it } from 'vitest'
import {
  CLAUDE_TOKEN_TWEEN_IDLE,
  claudeFooterStats,
  claudeThinkingStatus,
  formatClaudeElapsed,
  formatClaudeTokenCount,
  tokenTweenSettled,
  tokenTweenValue,
  updateTokenTween
} from './claude-working-footer-stats'

// The Claude app's working-footer stats (zs20.java:595-607, 886-1046; strings.xml
// `ccr_thinking_elapsed_*`, `ccr_thinking_status_*`, plurals `ccr_thinking_token_count`).

const START = Date.parse('2026-10-15T12:29:33Z')
const after = (seconds: number) => START + seconds * 1000

describe('the working footer’s stats, as the Claude app writes them', () => {
  it('reads "15s · still thinking…" fifteen seconds into a thinking turn (the user’s screenshot)', () => {
    expect(claudeFooterStats({ turnStartedAt: START, thinking: true, thinkingTokens: null }, after(15))).toEqual({ stats: '15s', status: 'still thinking…' })
  })

  it('writes elapsed time as seconds, then minutes and seconds, never hours or padding', () => {
    expect(formatClaudeElapsed(0)).toBe('0s')
    expect(formatClaudeElapsed(59)).toBe('59s')
    expect(formatClaudeElapsed(60)).toBe('1m 0s')
    expect(formatClaudeElapsed(65)).toBe('1m 5s')
    expect(formatClaudeElapsed(3725)).toBe('62m 5s')
    expect(formatClaudeElapsed(12.9)).toBe('12s')
  })

  it('steps the thinking phrase every 15 seconds', () => {
    expect(claudeThinkingStatus(0)).toBe('thinking…')
    expect(claudeThinkingStatus(14)).toBe('thinking…')
    expect(claudeThinkingStatus(15)).toBe('still thinking…')
    expect(claudeThinkingStatus(29)).toBe('still thinking…')
    expect(claudeThinkingStatus(30)).toBe('thinking more…')
    expect(claudeThinkingStatus(45)).toBe('thinking some more…')
    expect(claudeThinkingStatus(60)).toBe('almost done thinking…')
    expect(claudeThinkingStatus(600)).toBe('almost done thinking…')
  })

  it('writes the token figure grouped, singular for one, in every phone locale alike', () => {
    expect(formatClaudeTokenCount(1)).toBe('1 token')
    expect(formatClaudeTokenCount(2)).toBe('2 tokens')
    expect(formatClaudeTokenCount(1234)).toBe('1,234 tokens')
  })

  it('puts tokens after the time, the status apart from both', () => {
    expect(claudeFooterStats({ turnStartedAt: START, thinking: true, thinkingTokens: 1234 }, after(65))).toEqual({ stats: '1m 5s · 1,234 tokens', status: 'almost done thinking…' })
    expect(claudeFooterStats({ turnStartedAt: START, thinking: false, thinkingTokens: 1234 }, after(12))).toEqual({ stats: '12s · 1,234 tokens', status: null })
  })

  it('with neither tokens nor thinking there are no stats: the line keeps its verb', () => {
    expect(claudeFooterStats({ turnStartedAt: START, thinking: false, thinkingTokens: null }, after(40))).toBeNull()
    expect(claudeFooterStats({ turnStartedAt: START, thinking: false, thinkingTokens: 0 }, after(40))).toBeNull()
  })

  it('an unknown start or a clock behind it reads 0s, never a negative time', () => {
    expect(claudeFooterStats({ turnStartedAt: null, thinking: true, thinkingTokens: null }, after(40))).toEqual({ stats: '0s', status: 'thinking…' })
    expect(claudeFooterStats({ turnStartedAt: START, thinking: true, thinkingTokens: null }, after(-5))).toEqual({ stats: '0s', status: 'thinking…' })
  })
})

// zs20.java:957-965 and :996: when a thinking span has just closed, the status is "thought for"
// the span (`ccr_thinking_status_thought_for` "thought for %1$s", the span written by `zs20.n`,
// at least 1 s) until 2 s after it closed (`a6y` ThinkingBlockBounds: startedAt, endedAt,
// closedAt). g8y.java: the token figure counts up rather than jumping.
describe('after a thinking span ends, as the Claude app says it', () => {
  const span = { startedAt: after(4), endedAt: after(12), closedAt: after(12) }

  it('says "thought for 8s" beside the time once Claude stops thinking', () => {
    expect(claudeFooterStats({ turnStartedAt: START, thinking: false, thinkingTokens: null }, after(13), { lastThinking: span })).toEqual({ stats: '13s', status: 'thought for 8s' })
  })

  it('drops the phrase 2 s after the span closed, and the line goes back to its verb', () => {
    expect(claudeFooterStats({ turnStartedAt: START, thinking: false, thinkingTokens: null }, after(13.999), { lastThinking: span })?.status).toBe('thought for 8s')
    expect(claudeFooterStats({ turnStartedAt: START, thinking: false, thinkingTokens: null }, after(14), { lastThinking: span })).toBeNull()
    expect(claudeFooterStats({ turnStartedAt: START, thinking: false, thinkingTokens: 40 }, after(14), { lastThinking: span })).toEqual({ stats: '14s · 40 tokens', status: null })
  })

  it('a span under a second still says "thought for 1s", and a long one reads minutes', () => {
    const blink = { startedAt: after(5), endedAt: after(5.2), closedAt: after(5.2) }
    expect(claudeFooterStats({ turnStartedAt: START, thinking: false, thinkingTokens: null }, after(6), { lastThinking: blink })?.status).toBe('thought for 1s')
    const zero = { startedAt: after(5), endedAt: after(5), closedAt: after(5) }
    expect(claudeFooterStats({ turnStartedAt: START, thinking: false, thinkingTokens: null }, after(5), { lastThinking: zero })?.status).toBe('thought for 1s')
    const long = { startedAt: after(0), endedAt: after(65), closedAt: after(65) }
    expect(claudeFooterStats({ turnStartedAt: START, thinking: false, thinkingTokens: null }, after(66), { lastThinking: long })?.status).toBe('thought for 1m 5s')
  })

  it('while thinking again the phrase is the thinking one, whatever the last span was', () => {
    expect(claudeFooterStats({ turnStartedAt: START, thinking: true, thinkingTokens: null }, after(13), { lastThinking: span })?.status).toBe('thinking…')
  })

  it('draws the figure the count-up has reached, never below 1 and never above the real one', () => {
    expect(claudeFooterStats({ turnStartedAt: START, thinking: true, thinkingTokens: 500 }, after(3), { shownTokens: 0 })?.stats).toBe('3s · 1 token')
    expect(claudeFooterStats({ turnStartedAt: START, thinking: true, thinkingTokens: 500 }, after(3), { shownTokens: 250 })?.stats).toBe('3s · 250 tokens')
    expect(claudeFooterStats({ turnStartedAt: START, thinking: true, thinkingTokens: 500 }, after(3), { shownTokens: 900 })?.stats).toBe('3s · 500 tokens')
  })
})

describe('the token count-up (g8y)', () => {
  it('the first figure counts up from 0 over 1.2 s', () => {
    const t = updateTokenTween(CLAUDE_TOKEN_TWEEN_IDLE, 1_000, 1200)
    expect(tokenTweenValue(t, 1_000)).toBe(0)
    expect(tokenTweenValue(t, 1_600)).toBe(600)
    expect(tokenTweenValue(t, 2_200)).toBe(1200)
    expect(tokenTweenValue(t, 9_000)).toBe(1200)
    expect(tokenTweenSettled(t, 2_199)).toBe(false)
    expect(tokenTweenSettled(t, 2_200)).toBe(true)
  })

  it('a rise runs over the time since the last figure, held between 0.3 s and 3 s, from where the count stood', () => {
    let t = updateTokenTween(CLAUDE_TOKEN_TWEEN_IDLE, 0, 100)
    t = updateTokenTween(t, 2_000, 300) // 2 s since the last figure: a 2 s rise from 100
    expect(tokenTweenValue(t, 2_000)).toBe(100)
    expect(tokenTweenValue(t, 3_000)).toBe(200)
    expect(tokenTweenValue(t, 4_000)).toBe(300)
    t = updateTokenTween(t, 2_100, 400) // 0.1 s since: held at 0.3 s, from the 110 reached so far
    expect(tokenTweenValue(t, 2_100)).toBe(110)
    expect(tokenTweenValue(t, 2_250)).toBe(255)
    expect(tokenTweenValue(t, 2_400)).toBe(400)
    t = updateTokenTween(t, 60_000, 1_400) // a minute since: held at 3 s
    expect(tokenTweenValue(t, 61_500)).toBe(900)
  })

  it('a fall jumps straight to the new figure, and the same figure changes nothing', () => {
    let t = updateTokenTween(CLAUDE_TOKEN_TWEEN_IDLE, 0, 500)
    t = updateTokenTween(t, 5_000, 200)
    expect(tokenTweenValue(t, 5_000)).toBe(200)
    expect(updateTokenTween(t, 6_000, 200)).toBe(t)
  })

  it('no figure resets it, so the next one counts up from 0 again', () => {
    let t = updateTokenTween(CLAUDE_TOKEN_TWEEN_IDLE, 0, 500)
    t = updateTokenTween(t, 1_000, null)
    expect(tokenTweenValue(t, 1_000)).toBeNull()
    t = updateTokenTween(t, 2_000, 600)
    expect(tokenTweenValue(t, 2_000)).toBe(0)
    expect(tokenTweenValue(t, 2_600)).toBe(300)
  })
})
