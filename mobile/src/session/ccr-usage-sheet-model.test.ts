/**
 * The Usage sheet as the Claude app 1.261009.20 shows it when its context ring is tapped
 * (2026-10-15 screenshots): Context window "36% used", "145.5k of 400k tokens"; Current session
 * "28% used", "Resets in 1 hr 38 min"; All models "11% used" and "Fable only" "3% used", each
 * "Resets Wed 6:59 pm". Times are read in the test's own zone, as the phone reads them.
 */
import { describe, expect, it } from 'vitest'
import { readCcrPlanRows } from './ccr-session-api'
import { contextMeterRow, formatClock, formatPlanReset, planCards, USAGE_SHEET_TEXT, usageMeterTone, usageSheetAccount } from './ccr-usage-sheet-model'

const local = (y: number, m: number, d: number, h: number, min: number): number => new Date(y, m - 1, d, h, min).getTime()
// Wednesday 2026-10-14, 17:21 local: the session resets 1 hr 38 min later, the week on Wed 21 at 6:59 pm.
const NOW = local(2026, 10, 14, 17, 21)
const seconds = (ms: number): number => Math.floor(ms / 1000)

/** The `limits` of the account's usage reply, shapes as the app's `UsageLimit` declares them. */
const appReply = {
  five_hour: { utilization: 28, resets_at: '2026-10-14T18:59:00Z' },
  seven_day: { utilization: 11, resets_at: '2026-10-21T18:59:00Z' },
  limits: [
    { kind: 'session', group: 'session', percent: 28, severity: 'normal', resets_at: new Date(local(2026, 10, 14, 18, 59)).toISOString(), scope: null, is_active: true },
    { kind: 'weekly_all', group: 'weekly', percent: 11, severity: 'normal', resets_at: new Date(local(2026, 10, 21, 18, 59)).toISOString(), scope: null, is_active: false },
    { kind: 'weekly_scoped', group: 'weekly', percent: 3, severity: 'normal', resets_at: new Date(local(2026, 10, 21, 18, 59)).toISOString(), scope: { model: { display_name: 'Fable' }, surface: null }, is_active: false }
  ]
}

describe('the Usage sheet’s plan cards', () => {
  it('reads Current session, All models and Fable only from the account’s limits', () => {
    const cards = planCards({ rows: readCcrPlanRows(appReply), failed: false }, NOW)
    expect(cards.session).toEqual([{ title: 'Current session', figure: '28% used', percent: 28, tone: 'normal', caption: 'Resets in 1 hr 38 min' }])
    expect(cards.weekly).toEqual([
      { title: 'All models', figure: '11% used', percent: 11, tone: 'normal', caption: 'Resets Wed 6:59 pm' },
      { title: 'Fable only', figure: '3% used', percent: 3, tone: 'normal', caption: 'Resets Wed 6:59 pm' }
    ])
    expect(cards.error).toBeNull()
  })

  it('has no scoped row when the account has no per-model weekly limit', () => {
    const rows = readCcrPlanRows({ limits: appReply.limits.slice(0, 2) })
    expect(planCards({ rows, failed: false }, NOW).weekly.map((row) => row.title)).toEqual(['All models'])
  })

  it('falls back to five_hour and seven_day when the reply has no limits', () => {
    const rows = readCcrPlanRows({ five_hour: appReply.five_hour, seven_day: appReply.seven_day })
    expect(rows.map((row) => [row.kind, row.percent])).toEqual([['session', 28], ['weekly_all', 11]])
  })

  it('leaves out a kind it does not know, a row with no percent and a scoped row with no model', () => {
    const rows = readCcrPlanRows({
      limits: [{ kind: 'overage', percent: 1 }, { kind: 'session' }, { kind: 'weekly_scoped', percent: 4, scope: { model: null } }, { kind: 'weekly_all', percent: 100.4 }]
    })
    expect(rows).toEqual([{ kind: 'weekly_all', percent: 100, resetsAt: null, modelName: null }])
  })

  it('puts the session row first whatever order the reply holds', () => {
    const rows = readCcrPlanRows({ limits: [appReply.limits[2], appReply.limits[0], appReply.limits[1]] })
    expect(rows.map((row) => row.kind)).toEqual(['session', 'weekly_scoped', 'weekly_all'])
  })

  it('shows Loading while the tab’s account is not known, never another account’s rows', () => {
    const cards = planCards(null, NOW)
    expect(cards.session).toEqual([{ title: 'Current session', figure: 'Loading', percent: null, tone: 'normal', caption: null }])
    expect(cards.weekly.map((row) => row.figure)).toEqual(['Loading'])
  })

  it('says so when nothing could be read, and keeps the rows when only a refresh failed', () => {
    expect(planCards({ rows: null, failed: true }, NOW)).toMatchObject({ session: [], weekly: [], error: USAGE_SHEET_TEXT.loadError })
    const kept = planCards({ rows: readCcrPlanRows(appReply), failed: true }, NOW)
    expect(kept.session).toHaveLength(1)
    expect(kept.refreshError).toBe('Couldn’t refresh usage')
  })

  it('draws 0% and 100% and turns the bar to a warning at 75 and critical at 90', () => {
    expect([0, 74, 75, 89, 90, 100].map(usageMeterTone)).toEqual(['normal', 'normal', 'warning', 'warning', 'critical', 'critical'])
    const cards = planCards({ rows: [{ kind: 'session', percent: 0, resetsAt: null, modelName: null }, { kind: 'weekly_all', percent: 100, resetsAt: null, modelName: null }], failed: false }, NOW)
    expect(cards.session[0]).toMatchObject({ figure: '0% used', percent: 0, caption: null })
    expect(cards.weekly[0]).toMatchObject({ figure: '100% used', percent: 100, tone: 'critical' })
  })
})

describe('the plan reset line', () => {
  it('counts down within a day and names the day beyond it', () => {
    expect(formatPlanReset(seconds(NOW + 7 * 60_000), NOW)).toBe('Resets in 7 min')
    expect(formatPlanReset(seconds(NOW + 30_000), NOW)).toBe('Resets in 1 min')
    expect(formatPlanReset(seconds(NOW + 98 * 60_000), NOW)).toBe('Resets in 1 hr 38 min')
    expect(formatPlanReset(seconds(local(2026, 10, 21, 18, 59)), NOW)).toBe('Resets Wed 6:59 pm')
    expect(formatPlanReset(seconds(local(2026, 10, 19, 0, 5)), NOW)).toBe('Resets Mon 12:05 am')
  })

  it('shows no line for a reset that is not stated or already passed', () => {
    expect(formatPlanReset(null, NOW)).toBeNull()
    expect(formatPlanReset(seconds(NOW - 1000), NOW)).toBeNull()
  })

  it('writes the clock the same way in every locale', () => {
    expect(formatClock(local(2026, 10, 14, 12, 0))).toBe('12:00 pm')
    expect(formatClock(local(2026, 10, 14, 9, 7))).toBe('9:07 am')
  })
})

describe('the Context window card', () => {
  it('shows the session’s answer: 36% used, 145.5k of 400k tokens', () => {
    expect(contextMeterRow({ answer: { usedTokens: 145_500, windowTokens: 400_000, percent: 36 }, figure: null, ask: 'idle' })).toEqual({
      title: 'Context window', figure: '36% used', percent: 36, tone: 'normal', caption: '145.5k of 400k tokens'
    })
  })

  it('shows an earlier answer with the time it was given while the session is asked again', () => {
    const row = contextMeterRow({ answer: null, figure: { usedTokens: 145_500, windowTokens: 400_000, percent: 36, updatedAt: local(2026, 10, 14, 17, 2) }, ask: 'asking' })
    expect(row).toMatchObject({ figure: '36% used', caption: '145.5k of 400k tokens · Updated 5:02 pm' })
  })

  it('says the session did not respond, in the app’s words', () => {
    const row = contextMeterRow({ answer: null, figure: null, ask: 'unanswered' })
    expect(row).toEqual({ title: 'Context window', figure: null, percent: null, tone: 'normal', caption: 'The session didn’t respond. Tap the refresh button to try again.' })
  })

  it('shows Loading while it asks with nothing in hand', () => {
    expect(contextMeterRow({ answer: null, figure: null, ask: 'asking' })).toMatchObject({ figure: 'Loading', percent: null, caption: null })
  })

  it('shows the tokens with no percent and no bar when the window is not known', () => {
    const row = contextMeterRow({ answer: null, figure: { usedTokens: 32_800, windowTokens: null, percent: null, updatedAt: null }, ask: 'idle' })
    expect(row).toEqual({ title: 'Context window', figure: null, percent: null, tone: 'normal', caption: '32.8k tokens' })
  })

  it('reads the ring’s own labels when it has no counts (the beacon)', () => {
    const row = contextMeterRow({ answer: null, figure: { usedTokens: null, windowTokens: null, usedLabel: '128k', windowLabel: '400k', percent: 32, updatedAt: null }, ask: 'idle' })
    expect(row).toMatchObject({ figure: '32% used', percent: 32, caption: '128k of 400k tokens' })
  })

  it('shows the status line’s bare percent as a bar with no token line', () => {
    const row = contextMeterRow({ answer: null, figure: { usedTokens: null, windowTokens: null, usedLabel: null, windowLabel: null, percent: 40, updatedAt: null }, ask: 'idle' })
    expect(row).toEqual({ title: 'Context window', figure: '40% used', percent: 40, tone: 'normal', caption: null })
  })

  it('draws a full context as 100% and critical', () => {
    expect(contextMeterRow({ answer: { usedTokens: 400_000, windowTokens: 400_000, percent: 100 }, figure: null, ask: 'idle' })).toMatchObject({ figure: '100% used', tone: 'critical' })
  })
})

describe('the account the sheet reads', () => {
  it('is the tab’s own target, its config dir’s before the match, and none otherwise', () => {
    expect(usageSheetAccount({ kind: 'target', sessionId: 'cse_w', accountId: 'work' }, 'personal')).toBe('work')
    expect(usageSheetAccount({ kind: 'refused', reason: 'unmatched' }, 'work')).toBe('work')
    expect(usageSheetAccount({ kind: 'refused', reason: 'other-account' }, 'work')).toBeNull()
    expect(usageSheetAccount({ kind: 'refused', reason: 'profile-unknown' }, null)).toBeNull()
    expect(usageSheetAccount({ kind: 'refused', reason: 'unsettled' }, 'work')).toBeNull()
  })
})
