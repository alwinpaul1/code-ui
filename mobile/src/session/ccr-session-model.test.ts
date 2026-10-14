import { beforeEach, describe, expect, it } from 'vitest'
import { claudeModelPillPair } from './claude-transcript-model'
import {
  CCR_MODEL_FRESH_MS,
  ccrModelForTab,
  ccrModelOfRow,
  forgetCcrModel,
  preferCcrModelPair,
  recordCcrModel,
  resetCcrModelForTests,
  type CcrModelReading
} from './ccr-session-model'

const reading = (overrides: Partial<CcrModelReading> = {}): CcrModelReading => ({
  sessionId: 'cse_01QXaaaaaaaaaaaaaaaaaaaa',
  epoch: 1,
  model: 'claude-opus-5-5',
  effort: 'xhigh',
  fetchedAt: 10_000,
  ...overrides
})

const today = { model: 'claude-sonnet-5', label: 'Sonnet 5', effort: 'medium' }

beforeEach(() => {
  resetCcrModelForTests()
})

describe('the model a session row reports', () => {
  it('is its external_metadata model and effort level', () => {
    expect(ccrModelOfRow({ model: 'claude-opus-5-5', effortLevel: 'high' })).toEqual({ model: 'claude-opus-5-5', effort: 'high' })
  })

  it('keeps a model with a context suffix as reported', () => {
    expect(ccrModelOfRow({ model: 'claude-opus-5-5[1m]', effortLevel: null })).toEqual({ model: 'claude-opus-5-5[1m]', effort: null })
  })

  it('drops an effort word the pill does not know, keeping the model', () => {
    expect(ccrModelOfRow({ model: 'claude-opus-5-5', effortLevel: 'turbo' })).toEqual({ model: 'claude-opus-5-5', effort: null })
  })

  it.each([
    ['no model', null, 'no-model'],
    ['an empty model', '  ', 'no-model'],
    ['a Claude id with no family the phone names', 'claude-mystery', 'unknown-model'],
    ['not a Claude id', 'gpt-5', 'unknown-model']
  ])('says why there is none for %s', (_name, model, skip) => {
    expect(ccrModelOfRow({ model, effortLevel: 'high' })).toEqual({ skip })
  })
})

describe('the pill’s pair', () => {
  it('is the session’s reported pair when fresh and no beacon was heard after it', () => {
    expect(preferCcrModelPair(today, reading(), null)).toEqual({ model: 'claude-opus-5-5', label: null, effort: 'xhigh' })
    expect(preferCcrModelPair(today, reading(), 9_000)).toEqual({ model: 'claude-opus-5-5', label: null, effort: 'xhigh' })
  })

  it('is today’s when the beacon spoke after the reading', () => {
    expect(preferCcrModelPair(today, reading(), 10_000)).toBe(today)
    expect(preferCcrModelPair(today, reading(), 11_000)).toBe(today)
  })

  it('is today’s when there is no reading (unmatched, stale or unknown id)', () => {
    expect(preferCcrModelPair(today, null, null)).toBe(today)
  })

  it('keeps the agent’s own name when the model is the same one, taking the reported effort', () => {
    expect(preferCcrModelPair({ model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'high' }, reading(), null)).toEqual({ model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'xhigh' })
  })

  it('never mixes a reported model with another source’s effort', () => {
    expect(preferCcrModelPair(today, reading({ effort: null }), null)).toEqual({ model: 'claude-opus-5-5', label: null, effort: null })
  })

  it('reaches the pill over the transcript fallback', () => {
    const pair = preferCcrModelPair({ model: null, label: null, effort: null }, reading(), null)
    expect(claudeModelPillPair(pair, { kind: 'transcript', model: { model: 'claude-sonnet-5', label: 'Sonnet 5' }, freshAsOf: 0 })).toEqual({
      model: 'claude-opus-5-5',
      label: null,
      effort: 'xhigh'
    })
  })
})

describe('a tab’s reading', () => {
  it('is fresh for a while on the connection it was read on', () => {
    recordCcrModel('tab', reading())
    expect(ccrModelForTab('tab', 1, 10_000 + CCR_MODEL_FRESH_MS)).toMatchObject({ model: 'claude-opus-5-5' })
  })

  it('goes stale', () => {
    recordCcrModel('tab', reading())
    expect(ccrModelForTab('tab', 1, 10_001 + CCR_MODEL_FRESH_MS)).toBeNull()
  })

  it('is not used on a later connection', () => {
    recordCcrModel('tab', reading())
    expect(ccrModelForTab('tab', 2, 10_000)).toBeNull()
  })

  it('is per tab, and can be forgotten', () => {
    recordCcrModel('tab', reading())
    expect(ccrModelForTab('other', 1, 10_000)).toBeNull()
    forgetCcrModel('tab')
    expect(ccrModelForTab('tab', 1, 10_000)).toBeNull()
  })
})
