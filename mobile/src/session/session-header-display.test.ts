import { describe, expect, it } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'
import {
  contextRingColor,
  contextRingStep,
  displayBranchName,
  sessionHeaderContextReading
} from './session-header-display'
import type { TerminalHudContextWindow } from './mobile-terminal-hud-parse'

const context = (usedPercent: number): TerminalHudContextWindow => ({
  usedPercent,
  usedLabel: '120.0k',
  windowLabel: '200.0k'
})

describe('the header context ring steps like the Claude app (blue, amber at 75, red at 90)', () => {
  it.each([
    [0, 'calm'],
    [74, 'calm'],
    [75, 'warning'],
    [89, 'warning'],
    [90, 'danger'],
    [100, 'danger']
  ] as const)('%i percent is %s', (percent, step) => {
    expect(contextRingStep(percent)).toBe(step)
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('takes each step colour from the %s theme, not a literal', (_scheme, palette) => {
    expect(contextRingColor('calm', palette)).toBe(palette.info)
    expect(contextRingColor('warning', palette)).toBe(palette.warning)
    expect(contextRingColor('danger', palette)).toBe(palette.danger)
  })
})

describe('the header shows no ring unless the session stated its context window', () => {
  it('draws a ring from a stated figure, rounded and clamped', () => {
    expect(sessionHeaderContextReading(context(89.6), null)).toEqual({ kind: 'ring', percent: 90, step: 'danger' })
    expect(sessionHeaderContextReading(context(140), null)).toEqual({ kind: 'ring', percent: 100, step: 'danger' })
    expect(sessionHeaderContextReading(context(-3), null)).toEqual({ kind: 'ring', percent: 0, step: 'calm' })
  })

  it('shows the tokens alone, with no percentage, when the host gives tokens and no window', () => {
    // Claude Code's transcript never records its window size (CLAUDE.md, 2026-09: a 493k session
    // called 246% full). The header must not guess one.
    const reading = sessionHeaderContextReading(null, 493_000)
    expect(reading).toEqual({ kind: 'tokens', usedLabel: '493k' })
    expect(JSON.stringify(reading)).not.toContain('%')
  })

  it('shows nothing when neither a figure nor tokens are known', () => {
    expect(sessionHeaderContextReading(null, null)).toBeNull()
    expect(sessionHeaderContextReading(null, undefined)).toBeNull()
    // A malformed token count is not a reading.
    expect(sessionHeaderContextReading(null, Number.NaN)).toBeNull()
    expect(sessionHeaderContextReading(null, -1)).toBeNull()
  })

  it('prefers the stated figure over the bare tokens', () => {
    expect(sessionHeaderContextReading(context(40), 9)?.kind).toBe('ring')
  })

  it('reads a zero-token session as tokens, not as nothing', () => {
    expect(sessionHeaderContextReading(null, 0)).toEqual({ kind: 'tokens', usedLabel: '0' })
  })
})

describe('the branch the header menu copies', () => {
  it('drops the refs/heads/ prefix and treats a detached HEAD (no branch) as none', () => {
    expect(displayBranchName('refs/heads/feature/header')).toBe('feature/header')
    expect(displayBranchName(null)).toBeNull()
    expect(displayBranchName('refs/heads/')).toBeNull()
    expect(displayBranchName('  ')).toBeNull()
    expect(displayBranchName('main')).toBe('main')
  })
})
