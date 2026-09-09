import { describe, expect, it } from 'vitest'
import type { ProviderRateLimits } from '../components/accounts-snapshot'
import type { TerminalHudObservation } from './mobile-terminal-hud-parse'
import { attachHudRateLimits, hudLimitsFromRateLimits } from './hud-rate-limits'

// 2026-09-09: the HUD no longer opens a terminal on the host to read the agent's
// files. Rate-limit windows come from the same `accounts.subscribe` the home
// screen already uses; the context figure comes from the screen alone.
const limits: ProviderRateLimits = {
  provider: 'claude',
  session: { usedPercent: 100, windowMinutes: 300, resetsAt: 1_788_960_000_000 },
  weekly: { usedPercent: 33, windowMinutes: 10_080, resetsAt: 1_789_300_000_000 },
  fableWeekly: { usedPercent: 48, windowMinutes: 10_080, resetsAt: 1_789_300_000_000 },
  updatedAt: 1_788_950_000_000,
  error: null,
  status: 'ok'
}

const screen: TerminalHudObservation = {
  modelLabel: 'Fable 5.1',
  modelId: 'claude-fable-5-1',
  effort: 'medium',
  context: { usedPercent: 26, usedLabel: '260k', windowLabel: '1.0M' },
  permissionMode: 'default'
} as TerminalHudObservation

describe('HUD rate limits come from the host, not from a terminal', () => {
  it('maps the session, weekly and Fable windows in that order', () => {
    expect(hudLimitsFromRateLimits(limits).map((row) => row.usedPercent)).toEqual([100, 33, 48])
    expect(hudLimitsFromRateLimits(null)).toEqual([])
  })

  it('rides on the screen context so the sheet can draw the bars', () => {
    const merged = attachHudRateLimits(screen, limits)
    expect(merged?.context?.usedPercent).toBe(26)
    expect(merged?.context?.limits?.length).toBe(3)
    expect(merged?.modelLabel).toBe('Fable 5.1')
  })

  it('never invents a context reading just to carry the limits', () => {
    const noContext = { ...screen, context: null }
    expect(attachHudRateLimits(noContext, limits)).toBe(noContext)
    expect(attachHudRateLimits(null, limits)).toBeNull()
  })
})
