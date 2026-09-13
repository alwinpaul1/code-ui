import { useEffect, useRef } from 'react'
import { Animated, Easing, View } from 'react-native'

const DOT = 6
const RING = 14

/** A small live dot with a halo that swells and fades, in place of the star
 *  (2026-09-13: the star read as too big and too busy). Native-driven, so it
 *  costs the JS thread nothing while the agent streams. */
export function MobileBackgroundTasksPulse({ color }: { color: string }) {
  const wave = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(wave, {
        toValue: 1,
        duration: 1600,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true
      })
    )
    loop.start()
    return () => loop.stop()
  }, [wave])
  return (
    <View
      style={{ width: RING, height: RING, alignItems: 'center', justifyContent: 'center' }}
      testID="background-tasks-pulse"
    >
      <Animated.View
        style={{
          position: 'absolute',
          width: RING,
          height: RING,
          borderRadius: RING / 2,
          borderWidth: 1,
          borderColor: color,
          opacity: wave.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
          transform: [{ scale: wave.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }]
        }}
      />
      <View style={{ width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: color }} />
    </View>
  )
}
