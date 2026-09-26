import { useEffect, useRef } from 'react'
import { Animated } from 'react-native'
import { useReducedMotion } from '../ui/use-reduced-motion'

/** The breath a still-running tool row draws with: its icon and its label
 *  share one, so they never drift apart (2026-09-26: the icon stood still while
 *  the label breathed). Held at full opacity when `active` is false, and when
 *  motion is reduced or not yet known. */
export function usePulseOpacity(active = true): Animated.Value {
  const pulse = useRef(new Animated.Value(1)).current
  const reducedMotion = useReducedMotion()
  useEffect(() => {
    // Motion reduced, or not yet known: the row stands at full opacity.
    if (!active || reducedMotion !== false) {
      pulse.setValue(1)
      return undefined
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.45, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true })
      ])
    )
    animation.start()
    return () => animation.stop()
  }, [active, pulse, reducedMotion])
  return pulse
}

/** Breathing label for a still-running tool, matching desktop's `animate-pulse`.
 *  Pass `opacity` to breathe with something beside it (the row's icon). */
export function PulsingText({
  style,
  numberOfLines,
  testID,
  opacity,
  children
}: {
  style?: React.ComponentProps<typeof Animated.Text>['style']
  numberOfLines?: number
  testID?: string
  opacity?: Animated.Value
  children: React.ReactNode
}) {
  const own = usePulseOpacity(opacity === undefined)
  const pulse = opacity ?? own
  return (
    <Animated.Text
      style={[style, { opacity: pulse }]}
      numberOfLines={numberOfLines}
      testID={testID}
    >
      {children}
    </Animated.Text>
  )
}
