import { useEffect, useRef } from 'react'
import { Animated, View } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'

/** Animated three-dot "agent is working" row, shown while the active agent is
 *  still producing a reply. Pure presentation — visibility is the caller's call. */
export function MobileAgentWorkingIndicator({ label = 'Working' }: { label?: string }) {
  const { colors, space } = useTheme()
  const dots = [
    useRef(new Animated.Value(0.3)).current,
    useRef(new Animated.Value(0.3)).current,
    useRef(new Animated.Value(0.3)).current
  ]

  useEffect(() => {
    const animations = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(dot, { toValue: 1, duration: 320, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.3, duration: 320, useNativeDriver: true })
        ])
      )
    )
    animations.forEach((a) => a.start())
    return () => animations.forEach((a) => a.stop())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        paddingHorizontal: space.xs,
        paddingVertical: space.xs
      }}
    >
      <Txt variant="caption" weight="medium" tone="accent">
        {label}
      </Txt>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {dots.map((dot, i) => (
          <Animated.View
            key={i}
            style={{
              width: 5,
              height: 5,
              borderRadius: 2.5,
              backgroundColor: colors.accent,
              opacity: dot
            }}
          />
        ))}
      </View>
    </View>
  )
}
