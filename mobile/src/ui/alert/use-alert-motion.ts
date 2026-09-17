import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'

import type { AlertMotion } from './alert-motion'

/** How long the card waits for the OS to say whether motion is reduced
 *  before it gives up and shows itself with full motion. The answer normally
 *  lands in a few milliseconds; this only matters when the accessibility
 *  service rejects or never replies, and an alert that never appears is
 *  worse than one that moves. */
export const ALERT_MOTION_PREFERENCE_WAIT_MS = 250

/**
 * Which transition the alert should run: a spring, or an opacity cross-fade
 * under reduced motion. `null` while the OS has not yet answered, so the card
 * holds at reveal 0 rather than starting a spring it would have to cancel.
 *
 * Why not `useReducedMotionEnabled` from onboarding: that hook stays `null`
 * for ever if `isReduceMotionEnabled` rejects (its catch swallows the error),
 * which is fine for a decorative loop that simply never starts and fatal for
 * a dialog. This one answers within ALERT_MOTION_PREFERENCE_WAIT_MS whatever
 * the OS does. The two sources compose like this: the fallback only fills a
 * `null` (`current ?? 'spring'`), so an answer that arrived first stands;
 * the OS's answer, early or late, always sets the value, so a late answer
 * corrects a fallback that had to guess. The OS is right and the fallback
 * is a placeholder, never the other way round.
 */
export function useAlertMotion(): AlertMotion | null {
  const [motion, setMotion] = useState<AlertMotion | null>(null)

  useEffect(() => {
    let mounted = true
    const apply = (reduced: boolean) => {
      if (mounted) {
        setMotion(reduced ? 'crossfade' : 'spring')
      }
    }
    const fallback = setTimeout(() => {
      if (mounted) {
        setMotion((current) => current ?? 'spring')
      }
    }, ALERT_MOTION_PREFERENCE_WAIT_MS)
    void AccessibilityInfo.isReduceMotionEnabled()
      .then(apply)
      .catch(() => undefined)
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', apply)
    return () => {
      mounted = false
      clearTimeout(fallback)
      subscription.remove()
    }
  }, [])

  return motion
}
