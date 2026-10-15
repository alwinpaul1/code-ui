import { describe, expect, it } from 'vitest'
import { claudeFooterStats, claudeThinkingStatus, formatClaudeElapsed, formatClaudeTokenCount } from './claude-working-footer-stats'

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
