import { describe, expect, it } from 'vitest'
import type { SessionCommandPair } from './claude-session-command-pair'
import { claudeIdFromLabel, claudeModelPillPair, withSessionCommandPair, type ClaudeModelFallback } from './claude-transcript-model'

// Source of each case is in docs/mobile-agent-hud.md ("Model and effort
// without a beacon"). Claude Code 2.1.289 wordings are modelled from its
// binary, not captured live.
const none: ClaudeModelFallback = { kind: 'none' }
const scan = (model: string, label: string, freshAsOf?: number): ClaudeModelFallback => ({
  kind: 'transcript',
  model: { model, label },
  ...(freshAsOf === undefined ? {} : { freshAsOf })
})
const opus55 = scan('claude-opus-5-5', 'Opus 5.5')
const noLive = { model: null, label: null, effort: null }
const cmd = (c: Partial<SessionCommandPair> & { label: string | null; effort: string | null }): SessionCommandPair => ({
  at: 1000,
  answeredAt: null,
  ...c
})
const shown = (fallback: ClaudeModelFallback, command: SessionCommandPair | null) =>
  claudeModelPillPair(noLive, withSessionCommandPair(fallback, command))

describe('model and effort of a session with no beacon and no badge', () => {
  it('a new desktop session before its first prompt states nothing: no transcript row, no command', () => {
    expect(shown(none, null)).toEqual(noLive)
  })

  it('after the first prompt it states the model alone, with no effort the agent never said', () => {
    expect(shown(opus55, null)).toEqual({ model: 'claude-opus-5-5', label: 'Opus 5.5', effort: null })
  })

  it("a session's own /effort pick is the effort of the model the transcript reads", () => {
    expect(shown(opus55, cmd({ label: null, effort: 'xhigh' }))).toEqual({
      model: 'claude-opus-5-5',
      label: 'Opus 5.5',
      effort: 'xhigh'
    })
  })

  it('a /model switch mid-session shows the new model at once, with the effort its output stated and not the old one', () => {
    expect(shown(opus55, cmd({ label: 'Fable 5.1', effort: null }))).toEqual({ model: 'claude-fable-5-1', label: 'Fable 5.1', effort: null })
    expect(shown(opus55, cmd({ label: 'Fable 5.1', effort: 'high' }))).toEqual({ model: 'claude-fable-5-1', label: 'Fable 5.1', effort: 'high' })
  })

  it('a /model switch names the model of a session whose transcript has no row yet (the 20-session scan missed it)', () => {
    expect(shown(none, cmd({ label: 'Opus 5.5', effort: 'medium' }))).toEqual({ model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'medium' })
  })

  it('an /effort pick with no model anywhere has nothing to attach to and states nothing', () => {
    expect(shown(none, cmd({ label: null, effort: 'high' }))).toEqual(noLive)
  })

  it('a live beacon beats both, even when it states no effort', () => {
    const live = { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: null }
    expect(claudeModelPillPair(live, withSessionCommandPair(opus55, cmd({ label: 'Fable 5.1', effort: 'max' })))).toEqual(live)
  })

  it('a model label it cannot map to an id is not guessed at', () => {
    expect(withSessionCommandPair(opus55, cmd({ label: 'Opus 4.8.5', effort: 'high' }))).toBe(opus55)
    expect(withSessionCommandPair(none, cmd({ label: 'Opus 4.8.5', effort: 'high' }))).toBe(none)
    expect(claudeIdFromLabel('Opus 5')).toBe('claude-opus-5')
    expect(claudeIdFromLabel('Opus 5.5')).toBe('claude-opus-5-5')
    expect(claudeIdFromLabel('Not a model')).toBeNull()
  })

  // Review of c91134b9a, P5: the CLI prints a note after some names.
  it('maps a label with the CLI’s trailing note, so its effort is not dropped for the rest of the session', () => {
    expect(claudeIdFromLabel('Opus 4.6 (1M context)')).toBe('claude-opus-4-6')
    expect(claudeIdFromLabel('Sonnet 5 (default)')).toBe('claude-sonnet-5')
    expect(shown(none, cmd({ label: 'Opus 4.6 (1M context)', effort: 'high' }))).toEqual({
      model: 'claude-opus-4-6',
      label: 'Opus 4.6',
      effort: 'high'
    })
  })

  it('reads a Claude id the harness names in a fallback notice', () => {
    expect(claudeIdFromLabel('claude-sonnet-5')).toBe('claude-sonnet-5')
    expect(claudeIdFromLabel('claude-opus-5-5[1m]')).toBe('claude-opus-5-5')
  })
})

// Review of c91134b9a, P2/P3: a model can change with no row the phone parses
// (alt+p picker, /fast promotion before it was parsed, a resume into a new
// process), and an older command row then outranked the newer scan.
describe('an older command row against a newer transcript scan', () => {
  const sonnetScan = (freshAsOf: number) => scan('claude-sonnet-5', 'Sonnet 5', freshAsOf)

  it('P3: a scan taken after a reply that followed the /model names another model, so the scan wins', () => {
    const pair = cmd({ label: 'Opus 5.5', effort: 'high', at: 1000, answeredAt: 2000 })
    expect(shown(sonnetScan(3000), pair)).toEqual({ model: 'claude-sonnet-5', label: 'Sonnet 5', effort: null })
  })

  it('P2: the same for an /effort pick, which was read under Opus and is not Sonnet’s', () => {
    const pair = cmd({ label: null, effort: 'max', at: 1000, answeredAt: 2000, boundModel: 'claude-opus-5-5' })
    expect(shown(sonnetScan(3000), pair)).toEqual({ model: 'claude-sonnet-5', label: 'Sonnet 5', effort: null })
  })

  it('keeps an /effort pick while the scan still names the model it was read under', () => {
    const pair = cmd({ label: null, effort: 'max', at: 1000, answeredAt: 2000, boundModel: 'claude-opus-5-5' })
    expect(shown(scan('claude-opus-5-5', 'Opus 5.5', 3000), pair)).toEqual({ model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'max' })
  })

  it('the command stands when no reply has come since it: nothing could have changed the model', () => {
    const pair = cmd({ label: 'Opus 5.5', effort: 'high', answeredAt: null })
    expect(shown(sonnetScan(3000), pair)).toEqual({ model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'high' })
  })

  it('the command stands when the scan predates the reply that followed it: the scan has not seen it', () => {
    const pair = cmd({ label: 'Opus 5.5', effort: 'high', at: 1000, answeredAt: 2000 })
    expect(shown(sonnetScan(1500), pair)).toEqual({ model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'high' })
  })

  it('the command stands when the scan names the same model (a dated id is the same model)', () => {
    const pair = cmd({ label: 'Opus 5.5', effort: 'high', at: 1000, answeredAt: 2000 })
    expect(shown(scan('claude-opus-5-5-20261001', 'Opus 5.5', 3000), pair)).toMatchObject({ effort: 'high' })
  })

  it('the command stands when the scan carries no time to compare against', () => {
    const pair = cmd({ label: 'Opus 5.5', effort: 'high', at: 1000, answeredAt: 2000 })
    expect(shown(scan('claude-sonnet-5', 'Sonnet 5'), pair)).toMatchObject({ model: 'claude-opus-5-5' })
  })
})
