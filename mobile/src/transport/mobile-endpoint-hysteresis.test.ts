import { describe, expect, it } from 'vitest'
import { MobileEndpointHysteresis } from './mobile-endpoint-hysteresis'

const options = {
  directSuccessesRequired: 3,
  directObservationMs: 30_000,
  failureCooldownMs: 60_000,
  minimumDwellMs: 60_000
}

describe('mobile endpoint hysteresis', () => {
  it('requires three authenticated direct successes across the observation and dwell windows', () => {
    const policy = new MobileEndpointHysteresis(0, options)

    expect(policy.recordDirectSuccess(60_000)).toBe(false)
    expect(policy.recordDirectSuccess(75_000)).toBe(false)
    expect(policy.recordDirectSuccess(90_000)).toBe(true)
  })

  it('resets progress and observes cooldown after a failure', () => {
    const policy = new MobileEndpointHysteresis(0, options)
    policy.recordDirectSuccess(60_000)
    policy.recordDirectFailure(61_000)

    expect(policy.canProbe(120_999)).toBe(false)
    expect(policy.canProbe(121_000)).toBe(true)
    expect(policy.recordDirectSuccess(121_000)).toBe(false)
    expect(policy.recordDirectSuccess(136_000)).toBe(false)
    expect(policy.recordDirectSuccess(151_000)).toBe(true)
  })

  it('doubles the failure cooldown per consecutive failure up to the ceiling, and resets on resume', () => {
    const policy = new MobileEndpointHysteresis(0, {
      directSuccessesRequired: 3,
      directObservationMs: 30_000,
      failureCooldownMs: 60_000,
      minimumDwellMs: 60_000,
      maxFailureCooldownMs: 600_000
    })
    policy.recordDirectFailure(0)
    expect(policy.canProbe(59_999)).toBe(false)
    expect(policy.canProbe(60_000)).toBe(true)
    policy.recordDirectFailure(60_000)
    expect(policy.canProbe(179_999)).toBe(false)
    expect(policy.canProbe(180_000)).toBe(true)
    policy.recordDirectFailure(180_000)
    expect(policy.canProbe(419_999)).toBe(false)
    expect(policy.canProbe(420_000)).toBe(true)
    for (let index = 0; index < 8; index += 1) {
      policy.recordDirectFailure(1_000_000)
    }
    expect(policy.canProbe(1_599_999)).toBe(false)
    expect(policy.canProbe(1_600_000)).toBe(true)
    policy.resetFailureBackoff(1_000_000)
    expect(policy.canProbe(1_060_000)).toBe(true)
  })
})
