import { describe, expect, it } from 'vitest'
import type { AiVaultSession } from '../../../src/shared/ai-vault-types'
import { historySession } from '../agent-history/agent-history-panel.test-support'
import {
  claudeModelPillPair,
  claudeTranscriptModelName,
  resolveClaudeModelFallback,
  transcriptModelForSession
} from './claude-transcript-model'

// The rows are what Orca's AI Vault scan answers `aiVault.listSessions` with
// (origin/main 8d6fec597b): `model` is the `message.model` of the LAST
// `type: "assistant"` record in the session's own transcript file
// (session-scanner-primary-parsers.ts:159-168).
const SESSION = 'a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f607'
const OTHER = '8b19cb22-996c-40e5-a887-a5323a9845e1'

function row(overrides: Partial<AiVaultSession> = {}): AiVaultSession {
  return historySession({
    id: `claude:${overrides.sessionId ?? SESSION}`,
    sessionId: SESSION,
    model: 'claude-opus-5-5',
    previewMessages: [
      { role: 'user', text: 'fix the header pill', timestamp: '2026-09-27T10:00:00.000Z' },
      { role: 'assistant', text: 'Done.', timestamp: '2026-09-27T10:00:30.000Z' }
    ],
    ...overrides
  })
}

describe('the model a Windows session last answered with, from the host session list', () => {
  it('shows the model that answered on a Windows host with no status line', () => {
    expect(transcriptModelForSession([row()], SESSION)).toEqual({
      model: 'claude-opus-5-5',
      label: 'Opus 5.5'
    })
  })

  it('shows nothing before the session has any assistant reply', () => {
    expect(
      transcriptModelForSession(
        [row({ model: null, previewMessages: [{ role: 'user', text: 'hi', timestamp: null }] })],
        SESSION
      )
    ).toBeNull()
  })

  it("never takes a neighbouring session's model when this session is not listed", () => {
    // The newest row is another session in the same folder. Taking "the most
    // recent session" would state a model this tab never ran.
    const newer = row({ sessionId: OTHER, id: `claude:${OTHER}`, model: 'claude-fable-5-1' })
    expect(transcriptModelForSession([newer], SESSION)).toBeNull()
    expect(transcriptModelForSession([newer, row()], SESSION)?.label).toBe('Opus 5.5')
  })

  it("does not take a subagent transcript's model, which shares the session id", () => {
    const sidechain = row({
      id: `claude:${SESSION}:agent-1`,
      model: 'claude-haiku-4-5',
      subagent: { parentSessionId: SESSION, agentType: 'Explore', status: 'completed' }
    })
    expect(transcriptModelForSession([sidechain], SESSION)).toBeNull()
    expect(transcriptModelForSession([sidechain, row()], SESSION)?.model).toBe('claude-opus-5-5')
  })

  it("drops Claude Code's own <synthetic> replies, which name no model", () => {
    // Claude Code writes API errors and similar local replies as assistant
    // records with `model: "<synthetic>"`; the scan keeps whatever came last.
    expect(transcriptModelForSession([row({ model: '<synthetic>' })], SESSION)).toBeNull()
  })

  it('drops a model id that is not a Claude one', () => {
    expect(transcriptModelForSession([row({ model: 'gpt-5.5' })], SESSION)).toBeNull()
    expect(transcriptModelForSession([row({ model: '   ' })], SESSION)).toBeNull()
  })

  it("does not read a Codex row that happens to carry this session's id", () => {
    expect(
      transcriptModelForSession([row({ agent: 'codex', model: 'claude-opus-5-5' })], SESSION)
    ).toBeNull()
  })

  it('skips rows it cannot read instead of failing the whole list', () => {
    const rows: unknown[] = [null, 'row', 42, { sessionId: SESSION }, row()]
    expect(transcriptModelForSession(rows, SESSION)?.label).toBe('Opus 5.5')
  })

  it('shows nothing for an empty list', () => {
    expect(transcriptModelForSession([], SESSION)).toBeNull()
  })
})

describe('naming a Claude model id the way the pill names it', () => {
  it.each([
    ['claude-opus-5-5', 'Opus 5.5'],
    ['claude-opus-5', 'Opus 5'],
    ['claude-fable-5-1', 'Fable 5.1'],
    ['claude-sonnet-4-5-20250929', 'Sonnet 4.5'],
    ['claude-opus-4-20250514', 'Opus 4'],
    ['claude-opus-4-0', 'Opus 4'],
    ['claude-3-5-haiku-20241022', 'Haiku 3.5'],
    ['claude-3-opus-20240229', 'Opus 3'],
    ['eu.anthropic.claude-opus-5-5-v1:0', 'Opus 5.5'],
    ['claude-sonnet-4-5@20250929', 'Sonnet 4.5']
  ])('%s reads %s', (id, name) => {
    expect(claudeTranscriptModelName(id)).toBe(name)
  })

  it('shows a Claude id it cannot name as the id itself, rather than hiding it', () => {
    // A family released after this table: the agent's own record still says
    // exactly what answered, so the pill says it verbatim.
    expect(claudeTranscriptModelName('claude-nova-1')).toBe('claude-nova-1')
  })

  it('names nothing for an id that is not Claude', () => {
    expect(claudeTranscriptModelName('<synthetic>')).toBeNull()
    expect(claudeTranscriptModelName('gpt-6-astra')).toBeNull()
    expect(claudeTranscriptModelName('')).toBeNull()
  })
})

describe('which model the pill states when there is no live pair', () => {
  // Both clocks are the phone's: how recent the transcript a reading speaks for
  // is, and when the first turn begun after the pick ended.
  const transcript = { model: 'claude-opus-5-5', label: 'Opus 5.5', freshAsOf: 1_000 }

  it('lets the beacon or the badge win over the transcript', () => {
    expect(
      resolveClaudeModelFallback({ liveModel: 'claude-fable-5-1', transcript, pick: null })
    ).toEqual({ kind: 'none' })
  })

  it('states the transcript model when nothing else speaks', () => {
    expect(resolveClaudeModelFallback({ liveModel: null, transcript, pick: null })).toEqual({
      kind: 'transcript',
      model: { model: 'claude-opus-5-5', label: 'Opus 5.5' }
    })
  })

  it("shows nothing after the phone's own pick until a turn begun after it has been scanned", () => {
    // The pill never states the phone's pick: a picked record is not the agent's
    // word (the 2026-09-18 "Fable Medium" on an Opus session). Nor the model the
    // transcript had before the pick, which the switch may have replaced.
    expect(
      resolveClaudeModelFallback({ liveModel: null, transcript, pick: { settledAt: null } })
    ).toEqual({ kind: 'none' })
    // The turn ended, but the only scan predates it.
    expect(
      resolveClaudeModelFallback({ liveModel: null, transcript, pick: { settledAt: 2_000 } })
    ).toEqual({ kind: 'none' })
    // Scanned after it: what answered, whether or not the switch took.
    expect(
      resolveClaudeModelFallback({
        liveModel: null,
        transcript: { ...transcript, freshAsOf: 2_000 },
        pick: { settledAt: 2_000 }
      })
    ).toEqual({ kind: 'transcript', model: { model: 'claude-opus-5-5', label: 'Opus 5.5' } })
  })

  it('shows nothing when the scan after a pick does not list the session', () => {
    expect(
      resolveClaudeModelFallback({ liveModel: null, transcript: null, pick: { settledAt: 2_000 } })
    ).toEqual({ kind: 'none' })
  })

  it('states nothing when there is no live pair, no scan and no pick', () => {
    expect(resolveClaudeModelFallback({ liveModel: null, transcript: null, pick: null })).toEqual({
      kind: 'none'
    })
  })
})

describe('the pair the header pill reads', () => {
  const nothing = { model: null, label: null, effort: null }

  it('is the live pair whenever there is one, effort included', () => {
    const live = { model: 'claude-opus-5', label: 'Opus 5 (1M context)', effort: 'xhigh' }
    expect(
      claudeModelPillPair(live, {
        kind: 'transcript',
        model: { model: 'claude-fable-5-1', label: 'Fable 5.1' }
      })
    ).toBe(live)
  })

  it('names the transcript model with no effort, which the transcript does not record', () => {
    expect(
      claudeModelPillPair(nothing, {
        kind: 'transcript',
        model: { model: 'claude-opus-5-5', label: 'Opus 5.5' }
      })
    ).toEqual({ model: 'claude-opus-5-5', label: 'Opus 5.5', effort: null })
  })

  it('is nothing when the fallback has nothing', () => {
    expect(claudeModelPillPair(nothing, { kind: 'none' })).toEqual(nothing)
  })
})
