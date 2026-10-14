import { useEffect, useRef } from 'react'
import { Text, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { useTheme } from '../theme/theme-context'
import { useReducedMotion } from '../ui/use-reduced-motion'
import { DICTATION_ROW_SPRING } from './MobileNativeChatDictationRow'

/** The caption's box, in lines of its text (Claude app 1.261009.20, `etq.S` with `z` true, as
 *  `yv8` calls `etq.R` at yv8.java:2257): two lines that read in full, a fading line above them
 *  and one line of air below, so the box is 4 lines tall whatever is said. */
export const DICTATION_CAPTION_BOX_LINES = 4
/** `rrb.P(29, 8)` on the caption (yv8.java:2257). */
export const DICTATION_CAPTION_PAD = { horizontal: 29, vertical: 8 } as const
/** `etq.h0`'s scrim: the screen colour behind the caption, rounded 32 dp (`kvc(32)`). */
const SCRIM_RADIUS = 32

/** What the caption shows: the take's words, nothing for none (`al4` case 2: blank is null). */
export function dictationCaptionText(spoken: string): string | null {
  const text = spoken.trim()
  return text.length > 0 ? text : null
}

/**
 * The live caption above the recording row: the words of the take as they are spoken, the way the
 * Claude app draws them while its field is folded away (1.261009.20, decompiled):
 *
 * - `yv8.java:2219-2257`: shown while the speech toolbar is up (`rs8.n3()`) and the take's
 *   transcript is not blank (`al4` case 2). The transcript is committed + interim as one string
 *   (`adw.q`, `djz.a`), so the caption is one colour throughout; no lighter interim here.
 * - `etq.S` (etq.java:3546-3626): the composer's text style (`jn7.B`, 17 sp / 1.4) in italic
 *   (`ygf(1)`), colour `pl7.P` (secondary text), aligned to the start. The box is a fixed four
 *   lines; the text sits on its bottom line of air and grows upward, so a new line never moves
 *   the chat. A vertical gradient mask fades the top line out.
 * - `etq.R` (etq.java:3511): it comes and goes with fade + expand / fade + shrink
 *   (`nmd.g`/`nmd.h`, Compose's default springs), keeping its last words while it leaves.
 * - `etq.h0` (etq.java:3811-3829): a "dictation-caption-scrim" of the screen colour fades in
 *   behind it.
 *
 * Here the mask is a gradient of the scrim's own colour laid over the top line: over the opaque
 * scrim the two look the same. Reduced motion: it appears and goes without the spring.
 */
export function MobileNativeChatDictationCaption({
  spoken,
  shown,
  textStyle
}: {
  /** The take's words so far (committed and interim). */
  spoken: string
  /** The recording row is up. */
  shown: boolean
  /** The composer's text style: font, size and line height. */
  textStyle: { fontFamily: string; fontSize: number; lineHeight: number }
}): React.JSX.Element {
  const { colors } = useTheme()
  const reducedMotion = useReducedMotion() === true
  const text = shown ? dictationCaptionText(spoken) : null
  const visible = text !== null
  // The last words, kept while the caption leaves (`etq.R` keeps them in its own state).
  const lastText = useRef('')
  if (text !== null) {
    lastText.current = text
  }
  const line = textStyle.lineHeight
  const boxHeight = DICTATION_CAPTION_BOX_LINES * line
  const fullHeight = boxHeight + 2 * DICTATION_CAPTION_PAD.vertical

  const progress = useSharedValue(visible ? 1 : 0)
  useEffect(() => {
    const target = visible ? 1 : 0
    progress.value = reducedMotion ? target : withSpring(target, DICTATION_ROW_SPRING)
  }, [progress, reducedMotion, visible])
  const outerStyle = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, progress.value))
    return { height: fullHeight * p, opacity: p }
  }, [fullHeight])

  return (
    <Animated.View
      pointerEvents="none"
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
      accessibilityElementsHidden={!visible}
      accessibilityLiveRegion={visible ? 'polite' : 'none'}
      style={[{ overflow: 'hidden', justifyContent: 'flex-end' }, outerStyle]}
      testID="native-chat-dictation-caption"
    >
      <View
        style={{
          height: fullHeight,
          paddingHorizontal: DICTATION_CAPTION_PAD.horizontal,
          paddingVertical: DICTATION_CAPTION_PAD.vertical,
          backgroundColor: colors.chatBg,
          borderRadius: SCRIM_RADIUS
        }}
      >
        <View style={{ height: boxHeight, overflow: 'hidden' }} testID="native-chat-dictation-caption-box">
          <Text
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: line,
              color: colors.textSecondary,
              fontFamily: textStyle.fontFamily,
              fontSize: textStyle.fontSize,
              lineHeight: line,
              fontStyle: 'italic',
              textAlign: 'left'
            }}
          >
            {lastText.current}
          </Text>
          <Svg
            pointerEvents="none"
            width="100%"
            height={line}
            style={{ position: 'absolute', left: 0, right: 0, top: 0 }}
            testID="native-chat-dictation-caption-fade"
          >
            <Defs>
              <LinearGradient id="dictationCaptionFade" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colors.chatBg} stopOpacity={1} />
                <Stop offset="1" stopColor={colors.chatBg} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height={line} fill="url(#dictationCaptionFade)" />
          </Svg>
        </View>
      </View>
    </Animated.View>
  )
}
