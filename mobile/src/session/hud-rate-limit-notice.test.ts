import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ProviderRateLimits } from '../components/accounts-snapshot'
import { parseAgentHudBeaconPayload, type AgentHudBeacon } from './agent-hud-beacon'
import { beaconDecidesLimits, hudRateLimitWindows, rateLimitNotice, type RateLimitWindowReading } from './hud-rate-limit-notice'

// The recorded beacon: Claude Code 2.1.296's status line, written to its own PTY and read back from
// the phone's store (fixtures/claude-busy-lead-tasks-2.1.296/beacon-payloads.txt, 2026-10-11). Its
// first line carries `h5=20:1791678000 d7=73:1791997200`: the 5-hour window at 20%, the weekly at
// 73%. Where a test needs another figure, only those two numbers are replaced; every other byte is
// the recorded line's.
const RECORDED = readFileSync(
  join(import.meta.dirname, 'fixtures/claude-busy-lead-tasks-2.1.296/beacon-payloads.txt'),
  'utf8'
).split('\n')[0]!

const SESSION_RESETS = 1_791_678_000
const WEEKLY_RESETS = 1_791_997_200
const HOUR = 3600
const WEEK = 604_800

/** The recorded line with its two limit figures replaced. */
function recordedWith(figures: { h5?: string; d7?: string }): AgentHudBeacon {
  const line = RECORDED.replace('h5=20:1791678000', `h5=${figures.h5 ?? '20:1791678000'}`).replace(
    'd7=73:1791997200',
    `d7=${figures.d7 ?? '73:1791997200'}`
  )
  const beacon = parseAgentHudBeaconPayload(line, 0)
  if (!beacon) {
    throw new Error(`the recorded payload did not parse: ${line.slice(0, 80)}`)
  }
  return beacon
}

/** The beacon as an older build's stored record holds it: no `limits` field at all. */
function withoutLimits(beacon: AgentHudBeacon): AgentHudBeacon {
  const { limits: _dropped, ...older } = beacon
  return older as AgentHudBeacon
}

/** An hour before the 5-hour window resets: 4 of its 5 hours gone is the wrong example for the
 *  5-hour rule, so tests that need another elapsed share pass their own `now`. */
const RECORDING_TIME = (SESSION_RESETS - HOUR) * 1000
const elapsedShare = (resetsAt: number, windowSeconds: number, nowMs: number): number =>
  Math.max(0, Math.min(1, (nowMs / 1000 - (resetsAt - windowSeconds)) / windowSeconds))

describe('the recorded payload (Claude Code 2.1.296)', () => {
  it('is what the fixture says: the 5-hour window at 20% and the weekly at 73%', () => {
    expect(recordedWith({}).limits).toEqual([
      { name: 'Session', usedPercent: 20, resetsAt: SESSION_RESETS },
      { name: 'Weekly', usedPercent: 73, resetsAt: WEEKLY_RESETS }
    ])
    // The share of the week gone at that moment, which the weekly rule below turns on.
    expect(elapsedShare(WEEKLY_RESETS, WEEK, RECORDING_TIME)).toBeCloseTo(0.466, 3)
  })

  it('draws nothing at the figures it was recorded with: 73% of the week is under the 75% tier', () => {
    const windows = hudRateLimitWindows(recordedWith({}), null)
    expect(rateLimitNotice({ windows, agent: 'claude', now: RECORDING_TIME })).toBeNull()
  })

  it('says "Approaching limit" at 76% of the week with under 60% of it gone', () => {
    const windows = hudRateLimitWindows(recordedWith({ d7: '76:1791997200' }), null)
    const notice = rateLimitNotice({ windows, agent: 'claude', now: RECORDING_TIME })
    expect(notice).toMatchObject({ kind: 'approaching', title: 'Approaching limit', dismissible: true })
  })

  it('draws nothing at 76% of the week once more than 60% of it is gone (Claude Code\'s own rule)', () => {
    // 4.5 days into the week: 64% gone, so a 76% reading is on pace and not warned about.
    const late = (WEEKLY_RESETS - 2.5 * 86_400) * 1000
    expect(elapsedShare(WEEKLY_RESETS, WEEK, late)).toBeGreaterThan(0.6)
    const windows = hudRateLimitWindows(recordedWith({ d7: '76:1791997200' }), null)
    expect(rateLimitNotice({ windows, agent: 'claude', now: late })).toBeNull()
  })

  it('says "Approaching limit" at 91% of the 5 hours with under 72% of it gone, and not after', () => {
    const windows = hudRateLimitWindows(recordedWith({ h5: '91:1791678000' }), null)
    // Two hours in: 40% gone.
    const early = (SESSION_RESETS - 3 * HOUR) * 1000
    expect(rateLimitNotice({ windows, agent: 'claude', now: early })).toMatchObject({ kind: 'approaching' })
    // Ninety minutes left: 70% gone, still inside the 72% line.
    const nearly = (SESSION_RESETS - 1.5 * HOUR) * 1000
    expect(rateLimitNotice({ windows, agent: 'claude', now: nearly })).toMatchObject({ kind: 'approaching' })
    // Half an hour left: 90% gone, on pace to reset before it runs out.
    const late = (SESSION_RESETS - 0.5 * HOUR) * 1000
    expect(rateLimitNotice({ windows, agent: 'claude', now: late })).toBeNull()
  })

  it('draws nothing at 89% of the 5 hours however early it is', () => {
    const windows = hudRateLimitWindows(recordedWith({ h5: '89:1791678000' }), null)
    expect(rateLimitNotice({ windows, agent: 'claude', now: (SESSION_RESETS - 4.5 * HOUR) * 1000 })).toBeNull()
  })

  it('draws nothing at 60% of the week early on: Claude Code computes that warning and never shows it under 70%', () => {
    const windows = hudRateLimitWindows(recordedWith({ d7: '60:1791997200' }), null)
    const early = (WEEKLY_RESETS - 6 * 86_400) * 1000
    expect(elapsedShare(WEEKLY_RESETS, WEEK, early)).toBeLessThan(0.15)
    expect(rateLimitNotice({ windows, agent: 'claude', now: early })).toBeNull()
  })

  it('says "Limit reached" at 100% and can be closed', () => {
    const windows = hudRateLimitWindows(recordedWith({ h5: '100:1791678000' }), null)
    const notice = rateLimitNotice({ windows, agent: 'claude', now: RECORDING_TIME })
    expect(notice).toMatchObject({ kind: 'reached', title: 'Limit reached', dismissible: true })
    expect(notice?.subtitle).toMatch(/^Resets (at |\w+ at )\d{1,2}:\d{2} [ap]m$/)
  })

  it('says "Try again later" for a limit reached when the agent did not state a reset', () => {
    // `h5=100:0` is how the writer sends a window with no reset time.
    const windows = hudRateLimitWindows(recordedWith({ h5: '100:0' }), null)
    expect(windows[0]).toMatchObject({ name: 'Session', usedPercent: 100, resetsAt: null })
    expect(rateLimitNotice({ windows, agent: 'claude', now: RECORDING_TIME })).toMatchObject({
      kind: 'reached',
      subtitle: 'Try again later'
    })
  })

  it('draws nothing for a window whose reset has passed, even at 100%', () => {
    // The agent states the last figure it saw; Claude Code's own docs say to expire any display of it
    // by `resetsAt`. A beacon from before the reset is not the present.
    const windows = hudRateLimitWindows(recordedWith({ h5: '100:1791678000' }), null)
    expect(rateLimitNotice({ windows, agent: 'claude', now: (SESSION_RESETS + 60) * 1000 })).toBeNull()
  })

  it('refuses an approaching call it cannot time: a reset the agent did not state', () => {
    const windows = hudRateLimitWindows(recordedWith({ d7: '90:0' }), null)
    expect(rateLimitNotice({ windows, agent: 'claude', now: RECORDING_TIME })).toBeNull()
  })

  it('draws nothing when the payload carries no limit at all', () => {
    const bare = parseAgentHudBeaconPayload(
      RECORDED.replace(/ h5=\S+/, '').replace(/ d7=\S+/, ''),
      0
    )
    expect(bare?.limits).toEqual([])
    expect(hudRateLimitWindows(bare, null)).toEqual([])
    expect(rateLimitNotice({ windows: hudRateLimitWindows(bare, null), agent: 'claude', now: RECORDING_TIME })).toBeNull()
  })

  it('says the limit that binds when both windows are full: the one that resets last', () => {
    const windows = hudRateLimitWindows(recordedWith({ h5: '100:1791678000', d7: '100:1791997200' }), null)
    const both = rateLimitNotice({ windows, agent: 'claude', now: RECORDING_TIME })
    const weeklyOnly = rateLimitNotice({
      windows: hudRateLimitWindows(recordedWith({ d7: '100:1791997200' }), null),
      agent: 'claude',
      now: RECORDING_TIME
    })
    expect(both?.subtitle).toBe(weeklyOnly?.subtitle)
    expect(both?.key).toBe(weeklyOnly?.key)
  })

  it('puts a limit reached ahead of one that is only close', () => {
    const windows = hudRateLimitWindows(recordedWith({ h5: '100:1791678000', d7: '76:1791997200' }), null)
    expect(rateLimitNotice({ windows, agent: 'claude', now: RECORDING_TIME })).toMatchObject({ kind: 'reached' })
  })
})

describe('the reset line, from a time the test names in local time', () => {
  const at = (day: number, hour: number, minute = 0): number => new Date(2026, 9, day, hour, minute).getTime()
  const secondsOf = (ms: number): number => Math.floor(ms / 1000)

  it('reads "Resets at 6:20 pm" for a reset later today', () => {
    const notice = rateLimitNotice({
      windows: [{ name: 'Session', usedPercent: 100, windowMinutes: null, resetsAt: secondsOf(at(14, 18, 20)) }],
      agent: 'claude',
      now: at(14, 10)
    })
    expect(notice?.subtitle).toBe('Resets at 6:20 pm')
  })

  it('reads "Resets Friday at 9:05 am" for a reset on another day', () => {
    // 16 October 2026 is a Friday.
    const notice = rateLimitNotice({
      windows: [{ name: 'Weekly', usedPercent: 100, windowMinutes: null, resetsAt: secondsOf(at(16, 9, 5)) }],
      agent: 'claude',
      now: at(14, 10)
    })
    expect(notice?.subtitle).toBe('Resets Friday at 9:05 am')
  })

  it('counts "today" from the reader\'s own midnight: 12:05 am tomorrow is another day', () => {
    const notice = rateLimitNotice({
      windows: [{ name: 'Session', usedPercent: 100, windowMinutes: null, resetsAt: secondsOf(at(15, 0, 5)) }],
      agent: 'claude',
      now: at(14, 23, 50)
    })
    expect(notice?.subtitle).toBe('Resets Thursday at 12:05 am')
  })
})

describe('Codex, whose windows come from the host (accounts.subscribe)', () => {
  const limits = (session: number | null, weekly: number | null, fable: number | null = null): ProviderRateLimits => ({
    provider: 'codex',
    session: session === null ? null : { usedPercent: session, windowMinutes: 300, resetsAt: 1_791_678_000_000, resetDescription: null },
    weekly: weekly === null ? null : { usedPercent: weekly, windowMinutes: 10_080, resetsAt: 1_791_997_200_000, resetDescription: null },
    fableWeekly: fable === null ? null : { usedPercent: fable, windowMinutes: 10_080, resetsAt: 1_791_997_200_000, resetDescription: null },
    updatedAt: 0,
    error: null,
    status: 'ok'
  })
  const read = (value: ProviderRateLimits | null) => rateLimitNotice({ windows: hudRateLimitWindows(null, value), agent: 'codex', now: RECORDING_TIME })

  it('says "Limit reached" at 100% of a window and "Approaching limit" from 75%, Codex\'s own first warning', () => {
    expect(read(limits(100, 10))).toMatchObject({ kind: 'reached' })
    expect(read(limits(10, 75))).toMatchObject({ kind: 'approaching' })
    expect(read(limits(74, 10))).toBeNull()
  })

  it('draws nothing from a host that sent no windows', () => {
    expect(read(null)).toBeNull()
    expect(read(limits(null, null))).toBeNull()
  })

  it('leaves the Fable window out: it is one model\'s limit, and the agent is not said to be using it', () => {
    expect(read(limits(10, 10, 100))).toBeNull()
  })

  it('reads one window and none the same way', () => {
    expect(read(limits(100, null))).toMatchObject({ kind: 'reached' })
    expect(rateLimitNotice({ windows: [], agent: 'codex', now: RECORDING_TIME })).toBeNull()
  })
})

describe('where the figures come from', () => {
  it('prefers the beacon, the agent\'s own statement of this session, over the host feed', () => {
    const hostSays: ProviderRateLimits = {
      provider: 'claude',
      session: { usedPercent: 5, windowMinutes: 300, resetsAt: 1_791_678_000_000, resetDescription: null },
      weekly: null,
      updatedAt: 0,
      error: null,
      status: 'ok'
    }
    const rows = hudRateLimitWindows(recordedWith({ h5: '100:1791678000' }), hostSays)
    expect(rows.map((row) => row.usedPercent)).toEqual([100, 73])
  })

  const fullSession: ProviderRateLimits = {
    provider: 'claude',
    session: { usedPercent: 100, windowMinutes: 300, resetsAt: 1_791_678_000_000, resetDescription: null },
    weekly: null,
    updatedAt: 0,
    error: null,
    status: 'ok'
  }

  it('does not ask the host feed about a Claude session whose own beacon carries no limit (an API-key session)', () => {
    // Claude Code leaves `rate_limits` out of the payload for a session with no subscription window.
    // The host's feed is for the account Orca is signed in with, which is not that session's: a
    // "Limit reached" from it would be about another login, and could not be closed.
    const bare = parseAgentHudBeaconPayload(RECORDED.replace(/ h5=\S+/, '').replace(/ d7=\S+/, ''), 0)
    expect(hudRateLimitWindows(bare, fullSession)).toEqual([])
  })

  it('asks the host feed when there is no beacon to ask: a hand-started tab, or a host with no flag', () => {
    const rows: RateLimitWindowReading[] = hudRateLimitWindows(null, fullSession)
    expect(rows).toEqual([{ name: 'Session', usedPercent: 100, windowMinutes: 300, resetsAt: SESSION_RESETS }])
    expect(rateLimitNotice({ windows: rows, agent: 'claude', now: RECORDING_TIME })).toMatchObject({ kind: 'reached' })
  })

  it('asks the host feed for Codex even with its beacon in hand: that beacon never carries a limit', () => {
    const codex = parseAgentHudBeaconPayload('CUIHUD1 agent=codex sid=thread-1 model=gpt-6-astra effort=high used=22147 win=258400', 0)
    expect(codex?.limits).toEqual([])
    expect(hudRateLimitWindows(codex, { ...fullSession, provider: 'codex' })).toHaveLength(1)
  })

  // A beacon restored from storage is not re-parsed (agent-hud-beacon-warm-start.ts keeps any
  // signed record), so one saved by an older build can lack `limits` entirely.
  it('asks the host feed for a Codex beacon saved without limits, rather than throwing', () => {
    const restored = withoutLimits(
      parseAgentHudBeaconPayload('CUIHUD1 agent=codex sid=thread-1 model=gpt-6-astra effort=high used=22147 win=258400', 0)!
    )
    expect(beaconDecidesLimits(restored)).toBe(false)
    expect(hudRateLimitWindows(restored, { ...fullSession, provider: 'codex' })).toHaveLength(1)
  })

  it('lets a Claude beacon saved without limits decide alone, with no window', () => {
    const restored = withoutLimits(recordedWith({}))
    expect(beaconDecidesLimits(restored)).toBe(true)
    expect(hudRateLimitWindows(restored, fullSession)).toEqual([])
  })

  it('has no beacon decide when there is none', () => {
    expect(beaconDecidesLimits(null)).toBe(false)
  })

  it('reads nothing from no beacon and no feed', () => {
    expect(hudRateLimitWindows(null, null)).toEqual([])
  })
})

describe('which window speaks when two are close', () => {
  const close = (session: number, weekly: number) => [
    { name: 'Session', usedPercent: session, windowMinutes: null, resetsAt: SESSION_RESETS },
    { name: 'Weekly', usedPercent: weekly, windowMinutes: null, resetsAt: WEEKLY_RESETS }
  ]

  it('is the 5-hour window for Claude Code, which checks it first, whatever the week says', () => {
    // 91% of the 5 hours with 3 hours gone; 96% of a week 47% gone. Both tiers fire; Claude Code's
    // `Nm` walks five_hour before seven_day and names the first.
    const notice = rateLimitNotice({ windows: close(91, 96), agent: 'claude', now: (SESSION_RESETS - 3 * HOUR) * 1000 })
    expect(notice?.key).toBe(`approaching:session:${SESSION_RESETS / 60}`)
  })

  it('is the fuller window for Codex, which warns on each by its own use', () => {
    const notice = rateLimitNotice({ windows: close(80, 90), agent: 'codex', now: RECORDING_TIME })
    expect(notice?.key).toBe(`approaching:weekly:${WEEKLY_RESETS / 60}`)
  })
})

describe('a dismissal and the two sources', () => {
  it('holds when the beacon and the host feed state the same reset a second apart', () => {
    const at = (resetsAt: number) =>
      rateLimitNotice({
        windows: [{ name: 'Weekly', usedPercent: 76, windowMinutes: null, resetsAt }],
        agent: 'claude',
        now: RECORDING_TIME
      })
    expect(at(WEEKLY_RESETS)?.key).toBe(at(WEEKLY_RESETS + 1)?.key)
    // A reset a week on is another cycle.
    expect(at(WEEKLY_RESETS)?.key).not.toBe(at(WEEKLY_RESETS + WEEK)?.key)
  })
})

describe('Now using usage credits', () => {
  it('is its own notice: no subtitle, dismissible, ahead of an approaching call', () => {
    const windows = hudRateLimitWindows(recordedWith({ d7: '76:1791997200' }), null)
    expect(rateLimitNotice({ windows, agent: 'claude', now: RECORDING_TIME, usingCredits: true })).toEqual({
      kind: 'credits',
      title: 'Now using usage credits',
      subtitle: null,
      dismissible: true,
      key: 'credits'
    })
  })

  it('is never drawn unless the source says so', () => {
    expect(rateLimitNotice({ windows: [], agent: 'claude', now: RECORDING_TIME })).toBeNull()
  })
})

describe('keys, so a dismissed notice stays dismissed only for itself', () => {
  it('differs by kind, by window and by reset cycle', () => {
    const near = rateLimitNotice({
      windows: hudRateLimitWindows(recordedWith({ d7: '76:1791997200' }), null),
      agent: 'claude',
      now: RECORDING_TIME
    })
    const full = rateLimitNotice({
      windows: hudRateLimitWindows(recordedWith({ d7: '100:1791997200' }), null),
      agent: 'claude',
      now: RECORDING_TIME
    })
    const nextWeek = rateLimitNotice({
      windows: hudRateLimitWindows(recordedWith({ d7: '76:1792602000' }), null),
      agent: 'claude',
      now: RECORDING_TIME + 7 * 86_400_000
    })
    expect(new Set([near?.key, full?.key, nextWeek?.key]).size).toBe(3)
  })
})
