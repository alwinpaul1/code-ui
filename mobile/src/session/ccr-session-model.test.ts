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
  const nothing = { model: null, label: null, effort: null }

  it('is the session’s reported pair when nothing live states one', () => {
    expect(preferCcrModelPair(nothing, reading(), null)).toEqual({ model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'xhigh' })
  })

  // Review of 2026-10-14: a row fetched after the beacon can still name the
  // model from before a switch (fetchedAt is the phone's read, not when Claude
  // Code wrote the metadata), and it stated Sonnet over the beacon's Opus.
  it('never overrides a beacon, however recently the row was fetched', () => {
    const beacon = { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'high' }
    expect(preferCcrModelPair(beacon, reading({ model: 'claude-sonnet-5', fetchedAt: 105 }), 100)).toBe(beacon)
    expect(preferCcrModelPair(nothing, reading({ fetchedAt: 105 }), 100)).toBe(nothing)
  })

  it('never overrides a live badge or a /model command the transcript recorded', () => {
    expect(preferCcrModelPair(today, reading(), null)).toBe(today)
  })

  it('is today’s when there is no reading (unmatched, stale or unknown id)', () => {
    expect(preferCcrModelPair(nothing, null, null)).toBe(nothing)
  })

  it('never mixes a reported model with another source’s effort', () => {
    expect(preferCcrModelPair(nothing, reading({ effort: null }), null)).toEqual({ model: 'claude-opus-5-5', label: 'Opus 5.5', effort: null })
  })

  it('outranks the transcript scan’s fallback in the pill', () => {
    const pair = preferCcrModelPair(nothing, reading(), null)
    expect(claudeModelPillPair(pair, { kind: 'transcript', model: { model: 'claude-sonnet-5', label: 'Sonnet 5' }, freshAsOf: 0 })).toEqual({
      model: 'claude-opus-5-5',
      label: 'Opus 5.5',
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
