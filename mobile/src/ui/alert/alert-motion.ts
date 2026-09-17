// How a system-style alert moves. Pure numbers, no react-native, so the
// values can be tested as arithmetic and the card component only wires them.
//
// Apple states a spring as (damping ratio, response): ratio 1 settles with no
// overshoot, response is roughly how long it takes to get there. Its default
// UI spring is ratio 1.0 at 0.3–0.4 s; a sheet flicked with momentum may use
// 0.8. React Native's Animated.spring takes the physics triplet instead, so
// the conversion below is what the card actually hands it.

export type AppleSpring = {
  /** 1 = critically damped (no overshoot); below 1 bounces. */
  dampingRatio: number
  /** Seconds. Not a duration, a spring has none, but close to one. */
  response: number
}

export type AnimatedSpringConfig = { stiffness: number; damping: number; mass: number }

/** k = (2π / response)², c = 2 · ratio · √(k · m), at unit mass. */
export function springFromAppleParams({ dampingRatio, response }: AppleSpring): AnimatedSpringConfig {
  if (!(response > 0)) {
    throw new Error(`spring response must be positive, got ${response}`)
  }
  const mass = 1
  const stiffness = (2 * Math.PI / response) ** 2
  const damping = 2 * dampingRatio * Math.sqrt(stiffness * mass)
  return { stiffness, damping, mass }
}

/** The alert's spring: Apple's default UI spring, in the middle of its range. */
export const ALERT_SPRING: AppleSpring = { dampingRatio: 1, response: 0.35 }

/** A UIAlertController arrives from slightly LARGER than rest. It comes
 *  toward the reader, not up from the page like a sheet. 1.1 is a visible
 *  arrival at 270 wide (27 px of travel) without the card ever looking like
 *  a different size. */
export const ALERT_ENTER_SCALE = 1.1

/** Reduced motion: an opacity cross-fade with no travel. Short enough not to
 *  read as a wait, long enough to see the card arrive rather than pop. */
export const ALERT_CROSSFADE_MS = 160

export type AlertMotion = 'spring' | 'crossfade'

/** What the card's scale interpolates through, reveal 0 → 1. Under reduced
 *  motion it does not move at all: the cross-fade is the whole transition. */
export function alertScaleRange(motion: AlertMotion): [number, number] {
  return motion === 'crossfade' ? [1, 1] : [ALERT_ENTER_SCALE, 1]
}
