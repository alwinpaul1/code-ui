import { useEffect } from 'react'
import {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming
} from 'react-native-reanimated'
import { useReducedMotion } from '../ui/use-reduced-motion'
import { AGENT_PULSE_PERIOD_MS, agentPulseAlpha } from './claude-motion-spec'

/**
 * One of the Claude app's five agent pulses (cu2.java:1071, claude-motion-spec.ts):
 * alpha 1.0 down to 0.55 and back on a 1200 ms cubic-bezier(0.4, 0, 0.2, 1)
 * tween, forever. `phase` (0 to 4) is how many 240 ms steps this pulse runs
 * ahead of the first; the workflow's status dot is the first (cu2.java:2609).
 *
 * One linear clock over a whole cycle drives it, since a Reanimated tween
 * cannot start part way along its timeline, which is what the app's negative
 * start offset does for the pulses after the first. Returns `null` while
 * `active` is false and while motion is reduced or not yet known: a decorative
 * loop holds at rest on `null` (use-reduced-motion.ts), so nothing moves and
 * nothing is drawn at a lower alpha.
 */
export function useAgentPulseStyle(active: boolean, phase = 0) {
  const reduced = useReducedMotion()
  const clock = useSharedValue(0)
  const pulsing = active && reduced === false
  useEffect(() => {
    if (!pulsing) {
      cancelAnimation(clock)
      clock.value = 0
      return undefined
    }
    clock.value = 0
    clock.value = withRepeat(
      withTiming(AGENT_PULSE_PERIOD_MS, { duration: AGENT_PULSE_PERIOD_MS, easing: Easing.linear }),
      -1,
      false
    )
    return () => cancelAnimation(clock)
  }, [pulsing, clock])
  const style = useAnimatedStyle(
    () => ({ opacity: agentPulseAlpha(clock.value, phase) }),
    // Named so the mapper has inputs where no Babel closure is written (the web bundle).
    [clock, phase]
  )
  return pulsing ? style : null
}
