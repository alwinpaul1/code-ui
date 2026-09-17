import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'

/** How long a surface waits for the OS to say whether motion is reduced
 *  before it gives up and runs with full motion. The answer normally lands
 *  in a few milliseconds; this only matters when the accessibility service
 *  rejects or never replies, and a drawer that never opens is worse than
 *  one that slides. */
export const REDUCED_MOTION_PREFERENCE_WAIT_MS = 250

/** The last thing the OS actually said, shared by every mount. Every mount
 *  asks again and the OS answers asynchronously; without this the thirtieth
 *  spinner in a list would hold for a tick and a drawer would draw its first
 *  frame before the answer landed. Only an answer is kept, never the
 *  fallback's guess. */
let lastKnown: boolean | null = null

/**
 * The OS's reduce-motion setting: `true`, `false`, or `null` while unknown.
 *
 * Three readings, by what the animation is:
 * - A one-shot entrance that can afford to wait (the alert) treats `null` as
 *   "hold": the setting decides the FIRST frame too, and the fallback below
 *   makes sure the hold is short.
 * - An entrance that must not wait (both drawers) treats `null` as full motion
 *   — `useReducedMotion() === true`. Holding there would mean an effect
 *   dependency on an async answer, and the recorded window hand-back path runs
 *   through those effects. The cost is that a reduce-motion user whose FIRST
 *   sheet opens before the OS answers gets one full slide; the cache makes that
 *   rare, because the home screen's spinners have usually asked already.
 *   Do not copy the alert's reading into a drawer without reading that path.
 * - A decorative loop (a spinner, a pulse) also holds at rest on `null`;
 *   a loop that started and had to be cancelled would be a flash of motion
 *   for the one user who asked for none.
 *
 * Why this and not onboarding's `useReducedMotionEnabled`: that one stayed
 * `null` for ever if `isReduceMotionEnabled` rejected, which is fine for a
 * decorative loop that simply never starts and fatal for a dialog. This one
 * answers within REDUCED_MOTION_PREFERENCE_WAIT_MS whatever the OS does, and
 * survives a runtime with no accessibility module at all. The two sources
 * compose like this: the fallback only fills a `null` (`current ?? false`),
 * so an answer that arrived first stands; the OS's answer, early or late,
 * always sets the value, so a late answer corrects a fallback that had to
 * guess. The OS is right and the fallback is a placeholder, never the other
 * way round.
 */
export function useReducedMotion(): boolean | null {
  const [reduced, setReduced] = useState<boolean | null>(lastKnown)

  useEffect(() => {
    let mounted = true
    const fallback = setTimeout(() => {
      if (mounted) {
        setReduced((current) => current ?? false)
      }
    }, REDUCED_MOTION_PREFERENCE_WAIT_MS)
    const apply = (value: boolean) => {
      lastKnown = value
      // An answered question leaves no timer behind: a settled row that
      // holds no interval must not hold this either.
      clearTimeout(fallback)
      if (mounted) {
        setReduced(value)
      }
    }
    let subscription: { remove: () => void } | null = null
    try {
      void AccessibilityInfo.isReduceMotionEnabled()
        .then(apply)
        .catch(() => undefined)
      subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', apply)
    } catch {
      // No accessibility module in this runtime. The fallback answers.
    }
    return () => {
      mounted = false
      clearTimeout(fallback)
      subscription?.remove()
    }
  }, [])

  return reduced
}

export function resetReducedMotionForTests(): void {
  lastKnown = null
}
