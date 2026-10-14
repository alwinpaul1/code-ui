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
 * The first of the Claude app's five agent pulses (cu2.java:1071,
 * claude-motion-spec.ts): alpha 1.0 down to 0.55 and back on a 1200 ms
 * cubic-bezier(0.4, 0, 0.2, 1) tween, forever. The workflow's status dot is
 * this one (cu2.java:2609). The app starts the other four later and holds them
 * at full alpha until then; they are not drawn here, so only this one is
 * driven, and its clock may wrap.
 *
 * One linear clock over a whole cycle drives it. The style is ALWAYS the one
 * animated style, whether the pulse runs or not: a view that had an animated
 * style and then lost it keeps the last opacity the UI thread wrote, so a dot
 * that stopped mid-pulse would stay dim. At rest the clock is 0, which the
 * curve reads as full alpha. It runs only while `active` and while motion is
 * known to be on: a decorative loop holds at rest on an unknown answer
 * (use-reduced-motion.ts).
 */
export function useAgentPulseStyle(active: boolean) {
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
  return useAnimatedStyle(
    () => ({ opacity: agentPulseAlpha(clock.value, 0) }),
    // Named so the mapper has inputs where no Babel closure is written (the web bundle).
    [clock]
  )
}
