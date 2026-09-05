import { useEffect } from 'react'
import { View } from 'react-native'
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming
} from 'react-native-reanimated'

/** A status dot. `pulse` adds an expanding ring for "working" states so a
 *  glance separates moving from merely alive. */
export function StatusPulse({
  color,
  size = 8,
  pulse = false
}: {
  color: string
  size?: number
  pulse?: boolean
}) {
  const progress = useSharedValue(0)
  useEffect(() => {
    if (pulse) {
      progress.value = 0
      progress.value = withRepeat(
        withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }),
        -1,
        false
      )
    } else {
      cancelAnimation(progress)
      progress.value = 0
    }
    return () => cancelAnimation(progress)
  }, [progress, pulse])
  const ringStyle = useAnimatedStyle(() => ({
    opacity: pulse ? 0.55 * (1 - progress.value) : 0,
    transform: [{ scale: 1 + progress.value * 1.6 }]
  }))
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color
          },
          ringStyle
        ]}
      />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  )
}
