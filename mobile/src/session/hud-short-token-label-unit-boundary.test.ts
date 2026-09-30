import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import { applyAgentStatusHudFields, hudFieldsFromAgentStatus, shortTokenLabel } from './hud-agent-status-fields'
import type { TerminalHudObservation } from './mobile-terminal-hud-parse'

// A session at 999,600 tokens drew "1000k/1.0M" beside the ring, on every HUD
// source: shortTokenLabel chose the unit before rounding, so a count just
// under a boundary rounded up into a number the next unit should have said.
// 99,960 read "100.0k" and 9,960,000 "10.0M" the same way (review,
// 2026-09-30). It now rounds first and names the unit of what it rounded to.

describe('the context label beside the ring, at the edge of each unit', () => {
  it.each([
    // Just under a thousand k: a million.
    [999_499, '999k'],
    [999_500, '1.0M'],
    [999_600, '1.0M'],
    [999_999, '1.0M'],
    [1_000_000, '1.0M'],
    // Just under a hundred k: a whole hundred k, with no decimal.
    [99_949, '99.9k'],
    [99_950, '100k'],
    [99_960, '100k'],
    [99_999, '100k'],
    [100_000, '100k'],
    // Just under ten M: a whole ten M, with no decimal.
    [9_949_999, '9.9M'],
    [9_950_000, '10M'],
    [9_960_000, '10M'],
    [9_999_999, '10M'],
    [10_000_000, '10M']
  ])('labels %i tokens %s', (tokens, label) => {
    expect(shortTokenLabel(tokens)).toBe(label)
  })

  it.each([
    [0, '0'],
    [999, '999'],
    [1000, '1.0k'],
    [12_300, '12.3k'],
    [150_000, '150k'],
    [649_000, '649k'],
    [1_500_000, '1.5M'],
    [12_345_678, '12M']
  ])('keeps the ordinary figure %i as %s', (tokens, label) => {
    expect(shortTokenLabel(tokens)).toBe(label)
  })

  it('draws a 999,600-token session as "1.0M" of "1.0M", not "1000k"', () => {
    const status = {
      state: 'working',
      prompt: '',
      updatedAt: 1,
      stateStartedAt: 1,
      paneKey: 'p',
      stateHistory: [],
      contextUsedTokens: 999_600,
      contextWindowTokens: 1_000_000
    } as unknown as AgentStatusEntry
    const screen: TerminalHudObservation = {
      modelLabel: 'Fable 5.1',
      modelId: 'fable',
      effort: null,
      context: null,
      permissionMode: 'acceptEdits'
    }
    const merged = applyAgentStatusHudFields(screen, hudFieldsFromAgentStatus(status))
    expect(merged?.context).toMatchObject({ usedLabel: '1.0M', windowLabel: '1.0M' })
  })
})
