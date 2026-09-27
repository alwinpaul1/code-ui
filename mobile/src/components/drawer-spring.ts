import { type AnimatedSpringConfig, springFromAppleParams } from '../ui/alert/alert-motion'

// How a drawer or sheet settles on a rest after a drag: the bottom drawer,
// its expandable form, the tool detail sheet and the right drawer.
//
// Stated the way Apple states a spring, ratio 1 (no overshoot), at the
// response the old triplet {damping 28, stiffness 400} had at unit mass:
// 2π / √400 ≈ 0.31 s, so nothing got slower. That triplet named no mass, and
// Reanimated 4 (4.5.1) merges a config over GentleSpringConfig, whose mass is
// 4: a ratio of 0.35, and every settle overshot its rest by about 31%. The
// Background tasks sheet sprang 50 dp up into the status bar and lifted its
// bottom off the screen (review of 2026-09-27). springFromAppleParams always
// names the mass, and spring-mass-census.test.ts keeps every spring doing so.
export const DRAWER_SPRING: AnimatedSpringConfig = springFromAppleParams({
  dampingRatio: 1,
  response: (2 * Math.PI) / Math.sqrt(400)
})
