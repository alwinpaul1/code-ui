import { useEffect } from 'react'
import {
  Easing,
  interpolateColor,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming
} from 'react-native-reanimated'
import { useTheme } from '../theme/theme-context'
import { USAGE_COLOR_STOPS } from './usage-color'

const USAGE_FADE_MS = 450

/**
 * One animated usage value, shared by the ring and the bars: the percentage
 * eases to its new value and the colour fades along the green→amber→red scale
 * instead of snapping at 70 and 90.
 *
 * `circumference` is only needed by the ring, for its dash offset.
 */
export function useUsageProgress(percent: number, circumference = 1) {
  const { colors } = useTheme()
  const pct = Math.max(0, Math.min(100, percent))
  const progress = useSharedValue(pct)
  useEffect(() => {
    progress.value = withTiming(pct, { duration: USAGE_FADE_MS, easing: Easing.out(Easing.cubic) })
  }, [pct, progress])
  const palette = [colors.success, colors.warning, colors.danger]
  const stops = [...USAGE_COLOR_STOPS]
  const barStyle = useAnimatedStyle(() => ({
    width: `${progress.value}%`,
    backgroundColor: interpolateColor(progress.value, stops, palette)
  }))
  const ringProps = useAnimatedProps(() => ({
    stroke: interpolateColor(progress.value, stops, palette),
    strokeDashoffset: circumference * (1 - progress.value / 100)
  }))
  return { barStyle, ringProps }
}
