import { describe, expect, it } from 'vitest'

import {
  ALERT_CROSSFADE_MS,
  ALERT_ENTER_SCALE,
  ALERT_SPRING,
  alertScaleRange,
  springFromAppleParams
} from './alert-motion'

// Apple states a spring as (damping ratio, response) rather than the physics
// triplet; React Native's Animated.spring wants stiffness/damping/mass. The
// conversion is the standard one for a unit mass: k = (2π/T)², c = 2ζ√k.

describe('an Apple spring stated as damping ratio and response', () => {
  it('turns into the stiffness and damping Animated.spring wants, at unit mass', () => {
    const spring = springFromAppleParams({ dampingRatio: 1, response: 0.35 })
    const k = (2 * Math.PI / 0.35) ** 2
    expect(spring.mass).toBe(1)
    expect(spring.stiffness).toBeCloseTo(k, 6)
    expect(spring.damping).toBeCloseTo(2 * Math.sqrt(k), 6)
  })

  it('is critically damped at ratio 1: it settles without a single overshoot', () => {
    const spring = springFromAppleParams({ dampingRatio: 1, response: 0.3 })
    // ζ = c / (2√(k·m)); ζ ≥ 1 means no oscillation.
    const ratio = spring.damping / (2 * Math.sqrt(spring.stiffness * spring.mass))
    expect(ratio).toBeCloseTo(1, 9)
  })

  it('bounces at ratio 0.8, which is what a sheet flicked with momentum wants', () => {
    const spring = springFromAppleParams({ dampingRatio: 0.8, response: 0.3 })
    const ratio = spring.damping / (2 * Math.sqrt(spring.stiffness * spring.mass))
    expect(ratio).toBeCloseTo(0.8, 9)
  })

  it('answers faster for a shorter response', () => {
    const quick = springFromAppleParams({ dampingRatio: 1, response: 0.2 })
    const slow = springFromAppleParams({ dampingRatio: 1, response: 0.4 })
    expect(quick.stiffness).toBeGreaterThan(slow.stiffness)
  })

  it('refuses a response of zero or less rather than dividing by it', () => {
    expect(() => springFromAppleParams({ dampingRatio: 1, response: 0 })).toThrow(/response/)
    expect(() => springFromAppleParams({ dampingRatio: 1, response: -0.3 })).toThrow(/response/)
  })
})

describe('the alert card', () => {
  it('uses Apple’s default UI spring: no overshoot, response inside 0.3–0.4 s', () => {
    expect(ALERT_SPRING.dampingRatio).toBe(1)
    expect(ALERT_SPRING.response).toBeGreaterThanOrEqual(0.3)
    expect(ALERT_SPRING.response).toBeLessThanOrEqual(0.4)
  })

  it('arrives from slightly larger, the way a UIAlertController does', () => {
    expect(ALERT_ENTER_SCALE).toBeGreaterThan(1)
    expect(alertScaleRange('spring')).toEqual([ALERT_ENTER_SCALE, 1])
  })

  it('does not move at all under reduced motion: a cross-fade only', () => {
    expect(alertScaleRange('crossfade')).toEqual([1, 1])
    expect(ALERT_CROSSFADE_MS).toBeGreaterThan(0)
    expect(ALERT_CROSSFADE_MS).toBeLessThanOrEqual(200)
  })
})
