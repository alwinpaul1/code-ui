import { describe, expect, it } from 'vitest'

import { formatResetCountdown, usageWindowTitle } from './usage-window-summary'

describe('usage window summary', () => {
  it('names windows the way the Claude app does', () => {
    expect(usageWindowTitle('session', true)).toBe('Current session')
    expect(usageWindowTitle('weekly', true)).toBe('All models')
    expect(usageWindowTitle('fableWeekly', true)).toBe('Fable only')
    expect(usageWindowTitle('weekly')).toBe('Weekly')
  })

  it('formats the reset countdown', () => {
    const now = 1_000_000_000
    expect(formatResetCountdown(now + (3 * 60 + 34) * 60_000, now)).toBe('Resets in 3 hr 34 min')
    expect(formatResetCountdown(now + 7 * 24 * 3_600_000, now)).toBe('Resets in 7d 0h')
    expect(formatResetCountdown(now + 12 * 60_000, now)).toBe('Resets in 12 min')
    expect(formatResetCountdown(now - 1, now)).toBe('Resets now')
  })
})
