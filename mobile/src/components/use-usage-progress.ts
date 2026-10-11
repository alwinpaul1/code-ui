import { useEffect } from 'react'
import {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming
} from 'react-native-reanimated'
import { useTheme } from '../theme/theme-context'
import { USAGE_COLOR_STOPS } from './usage-color'

const USAGE_FADE_MS = 450

/**
 * One animated usage value for the context sheet's bars: the percentage eases
 * to its new value and the colour fades along the green→amber→red scale
 * instead of snapping at 70 and 90. The header's ring does not use it: it
 * steps like the Claude app's (session-header-display.ts, since 2026-10-11).
 */
export function useUsageProgress(percent: number) {
  const { colors } = useTheme()
  const pct = Math.max(0, Math.min(100, percent))
  const progress = useSharedValue(pct)
  useEffect(() => {
    progress.value = withTiming(pct, { duration: USAGE_FADE_MS, easing: Easing.out(Easing.cubic) })
  }, [pct, progress])
  const palette = [colors.success, colors.warning, colors.danger]
  const stops = [...USAGE_COLOR_STOPS]
  // Dependency arrays named so the mappers have inputs where no Babel closure is written (the
  // web bundle); see reanimated-web-mapper-deps.test.ts.
  const barStyle = useAnimatedStyle(
    () => ({
      width: `${progress.value}%`,
      backgroundColor: interpolateColor(progress.value, stops, palette)
    }),
    [progress, stops, palette]
  )
  return { barStyle }
}
