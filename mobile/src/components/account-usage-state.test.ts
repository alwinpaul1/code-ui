import { describe, expect, it } from 'vitest'

import {
  getInactiveProviderUsage,
  getUsageBarState,
  formatResetClock,
  getWindowResetLabel,
  hasActiveProviderUsage,
  hasFableWindow,
  hasRenderableUsage,
  type AccountsSnapshot,
  type InactiveAccountUsage,
  type ProviderRateLimits
} from './account-usage-state'

function makeLimits(overrides: Partial<ProviderRateLimits> = {}): ProviderRateLimits {
  return {
    provider: 'claude',
    session: null,
    weekly: null,
    monthly: null,
    updatedAt: 0,
    error: null,
    status: 'idle',
    ...overrides
  }
}

function makeSnapshot(
  overrides: {
    claudeLimits?: ProviderRateLimits | null
    codexLimits?: ProviderRateLimits | null
    claudeAccounts?: AccountsSnapshot['claude']['accounts']
    codexAccounts?: AccountsSnapshot['codex']['accounts']
    inactiveClaudeAccounts?: InactiveAccountUsage[]
    inactiveCodexAccounts?: InactiveAccountUsage[]
  } = {}
): AccountsSnapshot {
  return {
    claude: {
      accounts: overrides.claudeAccounts ?? [],
      activeAccountId: null,
      activeAccountIdsByRuntime: { host: null, wsl: {} }
    },
    codex: {
      accounts: overrides.codexAccounts ?? [],
      activeAccountId: null,
      activeAccountIdsByRuntime: { host: null, wsl: {} }
    },
    rateLimits: {
      claude: overrides.claudeLimits ?? null,
      codex: overrides.codexLimits ?? null,
      claudeTarget: { runtime: 'host', wslDistro: null },
      codexTarget: { runtime: 'host', wslDistro: null },
      inactiveClaudeAccounts: overrides.inactiveClaudeAccounts ?? [],
      inactiveCodexAccounts: overrides.inactiveCodexAccounts ?? []
    }
  }
}

describe('hasActiveProviderUsage', () => {
  it('is false when there are no rate limits at all', () => {
    expect(hasActiveProviderUsage(null)).toBe(false)
  })

  it('is true when a session window has data', () => {
    expect(
      hasActiveProviderUsage(
        makeLimits({
          status: 'ok',
          session: { usedPercent: 12, windowMinutes: 300, resetsAt: null, resetDescription: null }
        })
      )
    ).toBe(true)
  })

  it('is true when a successful fetch returned ok even with empty windows', () => {
    expect(hasActiveProviderUsage(makeLimits({ status: 'ok' }))).toBe(true)
  })

  it('is false for an unavailable/error provider with no window data (no creds)', () => {
    expect(hasActiveProviderUsage(makeLimits({ status: 'unavailable' }))).toBe(false)
    expect(hasActiveProviderUsage(makeLimits({ status: 'error', error: 'nope' }))).toBe(false)
  })
})

describe('hasRenderableUsage', () => {
  it('is true when the provider has at least one managed account', () => {
    const snapshot = makeSnapshot({
      claudeAccounts: [{ id: 'a', email: 'x@y.z' }]
    })
    expect(hasRenderableUsage(snapshot, 'claude')).toBe(true)
  })

  // The bug: system-default auth has zero managed accounts but real usage data,
  // and the home screen used to hide it entirely.
  it('is true with zero managed accounts when active rate-limit data exists (system default)', () => {
    const snapshot = makeSnapshot({
      codexLimits: makeLimits({
        provider: 'codex',
        status: 'ok',
        session: { usedPercent: 40, windowMinutes: 300, resetsAt: null, resetDescription: null }
      })
    })
    expect(hasRenderableUsage(snapshot, 'codex')).toBe(true)
  })

  it('is false with zero accounts and no usable rate-limit data', () => {
    const snapshot = makeSnapshot({
      claudeLimits: makeLimits({ status: 'unavailable' })
    })
    expect(hasRenderableUsage(snapshot, 'claude')).toBe(false)
    expect(hasRenderableUsage(makeSnapshot(), 'claude')).toBe(false)
  })
})

describe('getInactiveProviderUsage', () => {
  it('returns inactive usage using the runtime rateLimits payload shape', () => {
    const limits = makeLimits({
      status: 'ok',
      session: { usedPercent: 52, windowMinutes: 300, resetsAt: null, resetDescription: null }
    })
    const snapshot = makeSnapshot({
      inactiveClaudeAccounts: [
        { accountId: 'account-1', rateLimits: limits, updatedAt: 123, isFetching: false }
      ]
    })

    expect(getInactiveProviderUsage(snapshot, 'claude', 'account-1')?.rateLimits).toBe(limits)
  })
})

describe('getWindowResetLabel', () => {
  const now = 1_700_000_000_000
  const min = 60_000
  const hour = 60 * min
  const day = 24 * hour

  function makeWindow(resetsAt: number | null): ProviderRateLimits['session'] {
    return { usedPercent: 13, windowMinutes: 300, resetsAt, resetDescription: null }
  }

  it('is null when there are no limits or the window has no reset timestamp', () => {
    expect(getWindowResetLabel(null, 'session', now)).toBe(null)
    expect(getWindowResetLabel(makeLimits({ status: 'ok' }), 'session', now)).toBe(null)
    expect(
      getWindowResetLabel(makeLimits({ status: 'ok', session: makeWindow(null) }), 'session', now)
    ).toBe(null)
  })

  it('session: the clock time it lands on; weekly: weekday and time', () => {
    const at47 = now + 47 * min
    expect(
      getWindowResetLabel(makeLimits({ session: makeWindow(at47) }), 'session', now)
    ).toBe(`Resets ${formatResetClock(at47)}`)
    const at3h54 = now + 3 * hour + 54 * min
    expect(
      getWindowResetLabel(makeLimits({ session: makeWindow(at3h54) }), 'session', now)
    ).toBe(`Resets ${formatResetClock(at3h54)}`)
    const weeklyAt = now + 6 * day + 7 * hour
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(weeklyAt).getDay()]
    expect(getWindowResetLabel(makeLimits({ weekly: makeWindow(weeklyAt) }), 'weekly', now)).toBe(
      `Resets ${weekday} ${formatResetClock(weeklyAt)}`
    )
  })

  it('formats the clock in 12-hour time with AM/PM and says "Resets now" once passed', () => {
    const noon = new Date(2026, 8, 5, 12, 5).getTime()
    expect(formatResetClock(noon)).toBe('12:05 PM')
    expect(formatResetClock(new Date(2026, 8, 5, 0, 30).getTime())).toBe('12:30 AM')
    expect(formatResetClock(new Date(2026, 8, 5, 19, 0).getTime())).toBe('7:00 PM')
    expect(getWindowResetLabel(makeLimits({ weekly: makeWindow(now - 1) }), 'weekly', now)).toBe(
      'Resets now'
    )
  })

  it('reports "Resets now" for a reset timestamp in the past', () => {
    expect(
      getWindowResetLabel(makeLimits({ session: makeWindow(now - min) }), 'session', now)
    ).toBe('Resets now')
  })

  it('reads the requested window only', () => {
    const limits = makeLimits({ session: makeWindow(now + hour) })
    expect(getWindowResetLabel(limits, 'weekly', now)).toBe(null)
  })
})

describe('getUsageBarState', () => {
  it('keeps stale window data visible during a transient error', () => {
    const bar = getUsageBarState(
      makeLimits({
        status: 'error',
        error: 'temporarily unavailable',
        session: { usedPercent: 72, windowMinutes: 300, resetsAt: null, resetDescription: null }
      }),
      'session'
    )

    expect(bar).toEqual({ usedPercent: 72, unavailable: false, loading: false })
  })

  it('shows loading for a fetching provider without a window', () => {
    expect(getUsageBarState(makeLimits({ status: 'fetching' }), 'weekly')).toEqual({
      usedPercent: null,
      unavailable: false,
      loading: true
    })
  })
})

describe('fable weekly window', () => {
  const now = Date.UTC(2026, 8, 5, 3, 0, 0)
  const fable = { usedPercent: 13, windowMinutes: 10080, resetsAt: now + 4 * 86_400_000 }

  it('is shown only when the host reports it', () => {
    expect(hasFableWindow(makeLimits())).toBe(false)
    expect(hasFableWindow(makeLimits({ fableWeekly: null }))).toBe(false)
    expect(hasFableWindow(makeLimits({ fableWeekly: fable }))).toBe(true)
  })

  it('reads the bar like the other windows and counts as usage', () => {
    const limits = makeLimits({ fableWeekly: fable, status: 'ok' })
    expect(getUsageBarState(limits, 'fableWeekly')).toEqual({
      usedPercent: 13,
      unavailable: false,
      loading: false
    })
    expect(hasActiveProviderUsage(makeLimits({ fableWeekly: fable, status: 'error' }))).toBe(true)
  })

  it('labels the reset like the weekly window', () => {
    const limits = makeLimits({ fableWeekly: fable })
    expect(getWindowResetLabel(limits, 'fableWeekly', now)).toBe(
      getWindowResetLabel(makeLimits({ weekly: fable }), 'weekly', now)
    )
  })
})
