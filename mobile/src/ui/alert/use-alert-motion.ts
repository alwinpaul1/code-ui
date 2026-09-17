import { REDUCED_MOTION_PREFERENCE_WAIT_MS, useReducedMotion } from '../use-reduced-motion'
import type { AlertMotion } from './alert-motion'

/** How long the card waits for the OS before it shows itself with full
 *  motion. The shared hook's wait; re-exported so the alert's tests keep
 *  naming the contract they pin. */
export const ALERT_MOTION_PREFERENCE_WAIT_MS = REDUCED_MOTION_PREFERENCE_WAIT_MS

/**
 * Which transition the alert should run: a spring, or an opacity cross-fade
 * under reduced motion. `null` while the OS has not yet answered, so the card
 * holds at reveal 0 rather than starting a spring it would have to cancel.
 *
 * The fallback-after-a-beat behaviour this hook was written for (0.6.6) now
 * lives in `useReducedMotion`, shared by every self-starting motion site in
 * the app; this is the alert's vocabulary over it.
 */
export function useAlertMotion(): AlertMotion | null {
  const reduced = useReducedMotion()
  if (reduced === null) {
    return null
  }
  return reduced ? 'crossfade' : 'spring'
}
