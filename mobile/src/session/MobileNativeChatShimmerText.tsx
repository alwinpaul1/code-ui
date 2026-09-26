import { useEffect } from 'react'
import { Text, type StyleProp, type TextStyle } from 'react-native'
import Animated, {
  cancelAnimation,
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue
} from 'react-native-reanimated'
import { useTheme } from '../theme/theme-context'
import { useReducedMotion } from '../ui/use-reduced-motion'
import { SHIMMER_PERIOD_MS, shimmerBandColor, shimmerBandWeight } from './mobile-native-chat-shimmer'
import { useChatRowOnScreen } from './native-chat-row-visibility'

/**
 * A still-running row's label with the Claude app's shimmer: a darker band
 * sweeps across it once every 1.5 s while the rest of the word keeps its
 * colour (the numbers are in mobile-native-chat-shimmer.ts). It replaced a
 * breath that faded the icon and the whole label together (2026-09-26).
 *
 * One text, one span per character, each span's colour driven from one shared
 * phase on the UI thread. It is still a single paragraph, so kerning, the
 * one-line cut and TalkBack read it exactly as the plain label, and a row that
 * settles does not shift. A colour-only change keeps the text measure cache
 * warm (React Native compares text layout without colour).
 *
 * The plain label, and no loop at all, when the row has finished, when motion
 * is reduced or not yet known, and when the row is scrolled off screen.
 */
export function ShimmerText({
  text,
  active,
  color,
  style,
  numberOfLines,
  testID
}: {
  text: string
  /** Whether the row is still running. */
  active: boolean
  /** The label's colour; the band is this sunk into the page. */
  color: string
  style?: StyleProp<TextStyle>
  numberOfLines?: number
  testID?: string
}) {
  const { colors } = useTheme()
  const reducedMotion = useReducedMotion()
  const onScreen = useChatRowOnScreen()
  const sweeping = active && reducedMotion === false && onScreen && text.length > 0
  const phase = useSharedValue(0)
  useEffect(() => {
    if (!sweeping) {
      cancelAnimation(phase)
      return undefined
    }
    phase.value = 0
    phase.value = withRepeat(
      withTiming(1, { duration: SHIMMER_PERIOD_MS, easing: Easing.linear }),
      -1,
      false
    )
    return () => cancelAnimation(phase)
  }, [phase, sweeping])

  if (!sweeping) {
    return (
      <Text style={[style, { color }]} numberOfLines={numberOfLines} testID={testID}>
        {text}
      </Text>
    )
  }
  const glyphs = Array.from(text)
  const band = shimmerBandColor(color, colors.bg)
  return (
    <Text style={[style, { color }]} numberOfLines={numberOfLines} testID={testID}>
      {glyphs.map((glyph, index) => (
        <ShimmerGlyph
          key={index}
          glyph={glyph}
          index={index}
          count={glyphs.length}
          phase={phase}
          color={color}
          band={band}
        />
      ))}
    </Text>
  )
}

function ShimmerGlyph({
  glyph,
  index,
  count,
  phase,
  color,
  band
}: {
  glyph: string
  index: number
  count: number
  phase: SharedValue<number>
  color: string
  band: string
}) {
  const sweep = useAnimatedStyle(
    () => ({
      color: interpolateColor(shimmerBandWeight(phase.value, index, count), [0, 1], [color, band])
    }),
    // Named so the mapper has inputs where no Babel closure is written (the web bundle).
    [phase, index, count, color, band]
  )
  return <Animated.Text style={sweep}>{glyph}</Animated.Text>
}
