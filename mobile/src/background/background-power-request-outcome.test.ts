import { describe, expect, it } from 'vitest'
import {
  BACKGROUND_POWER_REQUEST_WINDOW_MS,
  adviseBackgroundPowerRequestOutcome
} from './background-power-request-outcome'

/**
 * Tapping Allow fires ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, which on many
 * Android builds is the optimisation LIST rather than a yes/no dialog. You land
 * in a settings screen, do not find the app, back out — and it feels exactly
 * like having allowed. The grant never completed, the app never looked, and the
 * only sign was the same prompt returning later.
 *
 * Reported 2026-09-18 as "it also appeared for people who allowed too". They had
 * allowed: our sheet, not Android's.
 */
describe('did the exemption request actually take', () => {
  it('says nothing when no request is outstanding', () => {
    expect(
      adviseBackgroundPowerRequestOutcome({ requestedAgo: null, unrestricted: false })
    ).toBe('none')
  })

  it('reports the grant when it went through', () => {
    expect(adviseBackgroundPowerRequestOutcome({ requestedAgo: 4_000, unrestricted: true })).toBe(
      'granted'
    )
  })

  it('says it did not take when the user comes back still unexempt', () => {
    expect(adviseBackgroundPowerRequestOutcome({ requestedAgo: 4_000, unrestricted: false })).toBe(
      'not-taken'
    )
  })

  /**
   * The window exists because the marker outlives the trip. Someone who opens
   * the settings screen, gets distracted and returns tomorrow should not be told
   * their request failed — by then it is a stale marker, not an outcome. Nor
   * should a prompt fire days later with no memory of what it refers to.
   */
  it('forgets a request that is too old to be an answer', () => {
    expect(
      adviseBackgroundPowerRequestOutcome({
        requestedAgo: BACKGROUND_POWER_REQUEST_WINDOW_MS + 1,
        unrestricted: false
      })
    ).toBe('none')
  })

  // Still reported as granted past the window: the outcome is good news and the
  // marker wants clearing either way.
  it('still reports a late grant', () => {
    expect(
      adviseBackgroundPowerRequestOutcome({
        requestedAgo: BACKGROUND_POWER_REQUEST_WINDOW_MS + 1,
        unrestricted: true
      })
    ).toBe('granted')
  })

  // Degenerate: a clock that moved backwards. Treated as no request rather than
  // as one made in the future, which would report a failure that never happened.
  it('ignores a request that appears to be from the future', () => {
    expect(adviseBackgroundPowerRequestOutcome({ requestedAgo: -1_000, unrestricted: false })).toBe(
      'none'
    )
  })
})
