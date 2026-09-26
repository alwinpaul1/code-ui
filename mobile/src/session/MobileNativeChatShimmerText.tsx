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
import {
  SHIMMER_PERIOD_MS,
  shimmerBandColor,
  shimmerBandWeight,
  shimmerFramePhase
} from './mobile-native-chat-shimmer'
import { useChatRowOnScreen } from './native-chat-row-visibility'

/**
 * A still-running row's label with the Claude app's shimmer: a darker band
 * sweeps across it once every 1.5 s while the rest of the word keeps its
 * colour (the numbers are in mobile-native-chat-shimmer.ts). It replaced a
 * breath that faded the icon and the whole label together (2026-09-26).
 *
 * One text, one span per character, each span's colour driven from one shared
 * phase on the UI thread, stepped 40 times a second. It is still a single
 * paragraph, so the one-line cut and TalkBack read it as the plain label, and a
 * colour-only change keeps the text measure cache warm (React Native compares
 * text layout without colour). It is not drawn identically, though: on Android
 * each span is its own metric-affecting run, so no kerning pair crosses from
 * one glyph to the next, and the swept word can sit a pixel or so off the
 * plain one's width.
 *
 * Every glyph names the label's own face. The patched Text (patches/
 * react-native@0.86.3.patch) gives any Text that names none Instrument Sans
 * Regular, nested spans included, and a span's family beats the paragraph's:
 * a bare `{ color }` drew "Running agent" in Regular under a Medium label
 * (code review of c03f5328).
 *
 * The plain label, and no loop at all, when the row has finished, when motion
 * is reduced or not yet known, and when the row is scrolled off screen or its
 * screen is covered.
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
  const face = namedFace(style)
  return (
    <Text style={[style, { color }]} numberOfLines={numberOfLines} testID={testID}>
      {glyphs.map((glyph, index) => (
        <ShimmerGlyph
          key={index}
          glyph={glyph}
          index={index}
          count={glyphs.length}
          phase={phase}
          face={face}
          color={color}
          band={band}
        />
      ))}
    </Text>
  )
}

/** The face the label's style names, read the way StyleSheet.flatten would
 *  (a later entry wins), for each glyph to name again. */
function namedFace(style: StyleProp<TextStyle>): TextStyle {
  const face: TextStyle = {}
  const visit = (entry: unknown) => {
    if (Array.isArray(entry)) {
      entry.forEach(visit)
      return
    }
    if (entry && typeof entry === 'object') {
      const { fontFamily, fontWeight } = entry as TextStyle
      if (fontFamily !== undefined) {
        face.fontFamily = fontFamily
      }
      if (fontWeight !== undefined) {
        face.fontWeight = fontWeight
      }
    }
  }
  visit(style)
  return face
}

function ShimmerGlyph({
  glyph,
  index,
  count,
  phase,
  face,
  color,
  band
}: {
  glyph: string
  index: number
  count: number
  phase: SharedValue<number>
  face: TextStyle
  color: string
  band: string
}) {
  const sweep = useAnimatedStyle(
    () => ({
      color: interpolateColor(
        shimmerBandWeight(shimmerFramePhase(phase.value), index, count),
        [0, 1],
        [color, band]
      )
    }),
    // Named so the mapper has inputs where no Babel closure is written (the web bundle).
    [phase, index, count, color, band]
  )
  return <Animated.Text style={[face, sweep]}>{glyph}</Animated.Text>
}
