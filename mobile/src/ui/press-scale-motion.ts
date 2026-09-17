// How a pressed surface moves. Pure numbers, no react-native, so the springs
// can be tested as arithmetic and PressScale only wires them.

import { type AnimatedSpringConfig, springFromAppleParams } from './alert/alert-motion'

// Both springs are stated the way Apple states them, ratio 1 (no overshoot)
// at the response each had in 0.6.6. Those shipped as physics triplets,
// {20, 400, 0.6} and {16, 320, 0.6}, whose ratios were 0.65 and 0.58: a
// press dipped past its pressed size and a release grew past rest before
// settling. Same natural frequency as before, so nothing got slower; the
// motion now stops where it is going instead of bouncing there.

/** Finger lands: the surface scales down. √(400/0.6) rad/s ≈ 0.24 s. */
export const PRESS_IN_SPRING: AnimatedSpringConfig = springFromAppleParams({
  dampingRatio: 1,
  response: 0.24
})

/** Finger lifts: the surface springs back. √(320/0.6) rad/s ≈ 0.27 s, a
 *  touch slower than the way down, which is what a release should be. */
export const PRESS_OUT_SPRING: AnimatedSpringConfig = springFromAppleParams({
  dampingRatio: 1,
  response: 0.27
})

/** ζ = c / (2·√(k·m)). 1 settles with no overshoot; below 1 bounces. */
export function dampingRatio({ damping, stiffness, mass }: AnimatedSpringConfig): number {
  return damping / (2 * Math.sqrt(stiffness * mass))
}

/** Seconds per undamped cycle, 2π / √(k/m): what Apple calls the response. */
export function responseSeconds({ stiffness, mass }: AnimatedSpringConfig): number {
  return (2 * Math.PI) / Math.sqrt(stiffness / mass)
}
