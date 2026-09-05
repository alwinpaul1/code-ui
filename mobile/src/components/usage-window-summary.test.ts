import { describe, expect, it } from 'vitest'

import { getUsageHeadline, usageTone } from './usage-window-summary'

const window = (usedPercent: number, resetsAt: number | null = null) => ({
  usedPercent,
  windowMinutes: 300,
  resetsAt,
  resetDescription: null
})

describe('usage window summary', () => {
  it('leads with the most-used visible window', () => {
    const headline = getUsageHeadline(
      {
        provider: 'claude',
        session: window(7),
        weekly: window(16),
        fableWeekly: window(30),
        updatedAt: 1,
        error: null,
        status: 'ok'
      } as never,
      1
    )
    expect(headline?.key).toBe('fableWeekly')
    expect(headline?.usedPercent).toBe(30)
  })

  it('shows only the weekly window for a plan with no session window', () => {
    const headline = getUsageHeadline(
      {
        provider: 'codex',
        session: null,
        weekly: window(0, 5_000),
        updatedAt: 1,
        error: null,
        status: 'ok'
      } as never,
      1
    )
    expect(headline?.key).toBe('weekly')
    expect(headline?.resetLabel).toMatch(/^Resets /)
  })

  it('bands tone like the desktop status bar', () => {
    expect(usageTone(null)).toBe('muted')
    expect(usageTone(59)).toBe('success')
    expect(usageTone(60)).toBe('warning')
    expect(usageTone(80)).toBe('danger')
  })
})
