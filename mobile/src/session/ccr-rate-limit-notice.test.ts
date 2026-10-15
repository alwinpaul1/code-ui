import { describe, expect, it } from 'vitest'
import { parseCcrEvent } from './ccr-session-api'
import { deriveCcrLiveState } from './ccr-live-state'
import { ccrRateLimitNotice } from './ccr-rate-limit-notice'
import { RATE_LIMIT_TITLES } from './hud-rate-limit-notice'
import { event } from './fixtures/ccr-session-api-2026-10-14'
import { RESETS_AT_FIVE_HOUR, RESETS_AT_SEVEN_DAY, allowedFiveHour, rejectedFiveHour, warningSevenDay } from './fixtures/ccr-rate-limit-events-2026-10-15'

// The limit banner from the session's newest `rate_limit_event` (the shapes captured live on
// 2026-10-15, fixtures/ccr-rate-limit-events-2026-10-15.ts), the server's own call.

const LIVE = { liveFrom: 0, streamThinking: null, connectionStatus: 'connected' }
const BEFORE = (RESETS_AT_FIVE_HOUR - 3600) * 1000
const limitOf = (...payloads: Record<string, unknown>[]) => deriveCcrLiveState(payloads.map((payload) => parseCcrEvent(event(payload))!), LIVE).rateLimit

describe('the limit banner from Anthropic’s rate_limit_event', () => {
  it('a weekly warning is "Approaching limit", closable, keyed as the threshold path keys it', () => {
    const notice = ccrRateLimitNotice(limitOf(warningSevenDay('r1')), BEFORE)
    expect(notice).toMatchObject({ kind: 'approaching', title: RATE_LIMIT_TITLES.approaching, dismissible: true, key: `approaching:weekly:${Math.round(RESETS_AT_SEVEN_DAY / 60)}` })
    expect(notice?.subtitle).toMatch(/^Resets /)
  })

  it('rejected is "Limit reached", closable', () => {
    expect(ccrRateLimitNotice(limitOf(rejectedFiveHour('r1')), BEFORE)).toMatchObject({ kind: 'reached', title: RATE_LIMIT_TITLES.reached, dismissible: true, key: `reached:session:${Math.round(RESETS_AT_FIVE_HOUR / 60)}` })
  })

  it('rejected while using overage is the credits notice', () => {
    const payload = rejectedFiveHour('r1')
    const info = { ...(payload.rate_limit_info as Record<string, unknown>), isUsingOverage: true }
    expect(ccrRateLimitNotice(limitOf({ ...payload, rate_limit_info: info }), BEFORE)).toMatchObject({ kind: 'credits', title: RATE_LIMIT_TITLES.credits })
  })

  it('the newest event decides: allowed after a rejection clears the banner (null, not a fall-back)', () => {
    expect(ccrRateLimitNotice(limitOf(rejectedFiveHour('r1'), allowedFiveHour('r2')), BEFORE)).toBeNull()
  })

  it('no event, or one whose reset has passed, states nothing: the banner falls back to its thresholds', () => {
    expect(ccrRateLimitNotice(limitOf(), BEFORE)).toBeUndefined()
    expect(ccrRateLimitNotice(limitOf(rejectedFiveHour('r1')), (RESETS_AT_FIVE_HOUR + 1) * 1000)).toBeUndefined()
  })

  it('a reset written in milliseconds is read as the same moment, not 30,000 years away', () => {
    const payload = warningSevenDay('r1')
    const info = { ...(payload.rate_limit_info as Record<string, unknown>), resetsAt: RESETS_AT_SEVEN_DAY * 1000 }
    expect(limitOf({ ...payload, rate_limit_info: info })?.resetsAt).toBe(RESETS_AT_SEVEN_DAY)
  })
})
