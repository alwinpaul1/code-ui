import { describe, expect, it } from 'vitest'
import { claudeIdFromLabel, claudeModelPillPair, withSessionCommandPair, type ClaudeModelFallback } from './claude-transcript-model'

// Source of each case is in docs/mobile-agent-hud.md ("Model and effort
// without a beacon"). Claude Code 2.1.289 wordings are modelled from its
// binary, not captured live.
const none: ClaudeModelFallback = { kind: 'none' }
const opus55: ClaudeModelFallback = { kind: 'transcript', model: { model: 'claude-opus-5-5', label: 'Opus 5.5' } }
const noLive = { model: null, label: null, effort: null }

describe('model and effort of a session with no beacon and no badge', () => {
  it('a new desktop session before its first prompt states nothing: no transcript row, no command', () => {
    expect(claudeModelPillPair(noLive, withSessionCommandPair(none, null))).toEqual(noLive)
  })

  it('after the first prompt it states the model alone, with no effort the agent never said', () => {
    expect(claudeModelPillPair(noLive, withSessionCommandPair(opus55, null))).toEqual({
      model: 'claude-opus-5-5',
      label: 'Opus 5.5',
      effort: null
    })
  })

  it("a session's own /effort pick is the effort of the model the transcript reads", () => {
    expect(claudeModelPillPair(noLive, withSessionCommandPair(opus55, { label: null, effort: 'xhigh' }))).toEqual({
      model: 'claude-opus-5-5',
      label: 'Opus 5.5',
      effort: 'xhigh'
    })
  })

  it('a /model switch mid-session shows the new model at once, with the effort its output stated and not the old one', () => {
    expect(
      claudeModelPillPair(noLive, withSessionCommandPair(opus55, { label: 'Fable 5.1', effort: null }))
    ).toEqual({ model: 'claude-fable-5-1', label: 'Fable 5.1', effort: null })
    expect(
      claudeModelPillPair(noLive, withSessionCommandPair(opus55, { label: 'Fable 5.1', effort: 'high' }))
    ).toEqual({ model: 'claude-fable-5-1', label: 'Fable 5.1', effort: 'high' })
  })

  it('a /model switch names the model of a session whose transcript has no row yet (the 20-session scan missed it)', () => {
    expect(claudeModelPillPair(noLive, withSessionCommandPair(none, { label: 'Opus 5.5', effort: 'medium' }))).toEqual({
      model: 'claude-opus-5-5',
      label: 'Opus 5.5',
      effort: 'medium'
    })
  })

  it('an /effort pick with no model anywhere has nothing to attach to and states nothing', () => {
    expect(claudeModelPillPair(noLive, withSessionCommandPair(none, { label: null, effort: 'high' }))).toEqual(noLive)
  })

  it('a live beacon beats both, even when it states no effort', () => {
    const live = { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: null }
    expect(
      claudeModelPillPair(live, withSessionCommandPair(opus55, { label: 'Fable 5.1', effort: 'max' }))
    ).toEqual(live)
  })

  it('a model label it cannot map to an id is not guessed at', () => {
    expect(withSessionCommandPair(opus55, { label: 'Opus 4.8.5', effort: 'high' })).toBe(opus55)
    expect(withSessionCommandPair(none, { label: 'Opus 4.8.5', effort: 'high' })).toBe(none)
    expect(claudeIdFromLabel('Opus 5')).toBe('claude-opus-5')
    expect(claudeIdFromLabel('Opus 5.5')).toBe('claude-opus-5-5')
    expect(claudeIdFromLabel('Not a model')).toBeNull()
  })
})
