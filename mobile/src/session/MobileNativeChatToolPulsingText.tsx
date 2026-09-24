import { useEffect, useRef } from 'react'
import { Animated } from 'react-native'
import { useReducedMotion } from '../ui/use-reduced-motion'

/** Breathing label for a still-running tool, matching desktop's `animate-pulse`. */
export function PulsingText({
  style,
  numberOfLines,
  testID,
  children
}: {
  style?: React.ComponentProps<typeof Animated.Text>['style']
  numberOfLines?: number
  testID?: string
  children: React.ReactNode
}) {
  const pulse = useRef(new Animated.Value(1)).current
  const reducedMotion = useReducedMotion()
  useEffect(() => {
    // Motion reduced, or not yet known: the label stands at full opacity.
    if (reducedMotion !== false) {
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
  }, [pulse, reducedMotion])
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
