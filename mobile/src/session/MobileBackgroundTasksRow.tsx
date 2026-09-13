import { useEffect, useRef } from 'react'
import { Animated, Easing, Pressable } from 'react-native'
import { Sparkles } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { formatRunningTaskCount } from './mobile-background-task-labels'


/** "✳ 2 running tasks" under the last message, in the accent, opening the
 *  background-tasks sheet. Renders nothing when the agent has nothing in
 *  flight — which on a terminal-driven tab is always the case for agents that
 *  record no background tasks in their transcript (Codex). A structured tab
 *  counts the host's own roster instead, and that covers both agents. */
export function MobileBackgroundTasksRow({
  runningCount,
  onPress
}: {
  runningCount: number
  onPress: () => void
}) {
  const { colors, radius, space } = useTheme()
  if (runningCount <= 0) {
    return null
  }
  const label = formatRunningTaskCount(runningCount)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. Open background tasks`}
      onPress={onPress}
      hitSlop={10}
      style={({ pressed }) => ({
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.xs + 2,
        marginHorizontal: space.md,
        marginTop: space.xs,
        marginBottom: space.sm,
        paddingVertical: space.xs,
        paddingHorizontal: space.sm,
        borderRadius: radius.pill,
        backgroundColor: pressed ? colors.accentSoft : 'transparent'
      })}
    >
      <SpinningSparkle color={colors.accentText} />
      <Txt variant="label" weight="medium" tone="accent">
        {label}
      </Txt>
    </Pressable>
  )
}

/** The star turns slowly and breathes while tasks run (2026-09-13): a quiet
 *  sign of work in flight, not a spinner. Native-driven, so it costs the JS
 *  thread nothing while the agent streams. */
function SpinningSparkle({ color }: { color: string }) {
  const turn = useRef(new Animated.Value(0)).current
  const breath = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const spin = Animated.loop(
      Animated.timing(turn, { toValue: 1, duration: 6000, easing: Easing.linear, useNativeDriver: true })
    )
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true })
      ])
    )
    spin.start()
    pulse.start()
    return () => {
      spin.stop()
      pulse.stop()
    }
  }, [breath, turn])
  return (
    <Animated.View
      style={{
        transform: [
          { rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
          { scale: breath.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.15] }) }
        ],
        opacity: breath.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] })
      }}
    >
      <Sparkles size={14} color={color} />
    </Animated.View>
  )
}
