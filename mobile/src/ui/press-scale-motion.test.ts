import { describe, expect, it } from 'vitest'

import { dampingRatio, PRESS_IN_SPRING, PRESS_OUT_SPRING, responseSeconds } from './press-scale-motion'

// A button press is not a bounce. Shipped through 0.6.6, press-in ran at
// ζ ≈ 0.65 and release at ζ ≈ 0.58: both overshoot the target and come
// back, so a pressed surface dipped past its pressed size and a released
// one grew past rest before settling. Apple's default UI spring is ζ = 1.
describe('the press springs', () => {
  it('press-in is critically damped: it reaches the pressed size without overshoot', () => {
    expect(dampingRatio(PRESS_IN_SPRING)).toBeCloseTo(1, 6)
  })

  it('release is critically damped: it returns to rest without growing past it', () => {
    expect(dampingRatio(PRESS_OUT_SPRING)).toBeCloseTo(1, 6)
  })

  // The tempo was right; only the damping was wrong. These pin the natural
  // frequency the 0.6.6 triplets had (√(400/0.6) and √(320/0.6) rad/s), so
  // the fix changes how the motion settles and not how fast it starts.
  it('keeps press-in at the ~0.24 s response it had', () => {
    expect(responseSeconds(PRESS_IN_SPRING)).toBeCloseTo(0.24, 2)
  })

  it('keeps release at the ~0.27 s response it had, a touch slower than press-in', () => {
    expect(responseSeconds(PRESS_OUT_SPRING)).toBeCloseTo(0.27, 2)
    expect(responseSeconds(PRESS_OUT_SPRING)).toBeGreaterThan(responseSeconds(PRESS_IN_SPRING))
  })

  it('reads the ratio the way Reanimated does: ζ = c / 2√(k·m)', () => {
    expect(dampingRatio({ damping: 20, stiffness: 100, mass: 1 })).toBeCloseTo(1, 9)
    expect(dampingRatio({ damping: 10, stiffness: 100, mass: 1 })).toBeCloseTo(0.5, 9)
    // Mass matters: the same damping over a lighter mass is MORE damped.
    expect(dampingRatio({ damping: 20, stiffness: 400, mass: 0.6 })).toBeCloseTo(0.6455, 3)
  })
})
