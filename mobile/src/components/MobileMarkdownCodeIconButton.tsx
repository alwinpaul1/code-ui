import { useEffect, type ComponentType, type ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { Check, Copy } from 'lucide-react-native'
import { useReducedMotion } from '../ui/use-reduced-motion'
import { CODE_BLOCK_SPEC } from './code-block-spec'
import { systemSpScale } from './system-font-scale'

/** What a lucide icon takes, as far as these buttons use it. */
export type CodeGlyph = ComponentType<{ size?: number; color?: string; strokeWidth?: number }>

/**
 * One of the Claude app's icon buttons on a code block: a square, its glyph
 * centred, and a touch target that reaches 40 dp whatever the square's size
 * (`cf4.d()`, 40, for the Small and Medium sizes alike). The square and the
 * glyph are sized in sp, as the app sizes them with `krz.v`, so they follow
 * the system font size the way the label beside them does.
 */
export function CodeIconButton({
  label,
  onPress,
  sizeSp,
  touchTargetDp,
  children
}: {
  label: string
  onPress: () => void
  sizeSp: number
  touchTargetDp: number
  children: ReactNode
}) {
  const size = Math.round(systemSpScale().toDp(sizeSp))
  const slop = Math.max(0, Math.floor((touchTargetDp - size) / 2))
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={slop}
      style={({ pressed }) => ({
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.5 : 1
      })}
    >
      {children}
    </Pressable>
  )
}

/** A glyph's size in dp for a size given in sp. */
export function codeGlyphSize(glyphSp: number): number {
  return Math.round(systemSpScale().toDp(glyphSp))
}

/**
 * Copy's glyph, which becomes a check once the code is copied and goes back
 * after (`fa20.a`). The glyph swaps at once, and its colour moves from the
 * resting tone to the copied one over 300 ms: a second glyph in the copied
 * colour fades in over the first and fades out again on the way back, which
 * is that tween without a glyph that can take an animated colour. With motion
 * reduced (or not yet known) the colour changes at once.
 */
export function CodeCopyGlyph({
  copied,
  glyphSp,
  sizeDp,
  color,
  copiedColor
}: {
  copied: boolean
  color: string
  copiedColor: string
} & (
  // In sp, as the code block sizes it, or in dp where a surface keeps a fixed size that does
  // not follow the system font (the chat's action row, MobileNativeChatTurnActions).
  | { glyphSp: number; sizeDp?: undefined }
  | { sizeDp: number; glyphSp?: undefined }
)) {
  const size = sizeDp ?? codeGlyphSize(glyphSp)
  const Glyph: CodeGlyph = copied ? Check : Copy
  const progress = useSharedValue(0)
  const reduced = useReducedMotion()
  useEffect(() => {
    const target = copied ? 1 : 0
    if (progress.value === target) {
      return
    }
    cancelAnimation(progress)
    progress.value = reduced === false ? withTiming(target, { duration: CODE_BLOCK_SPEC.copy.tintMs }) : target
  }, [copied, reduced, progress])
  const tintStyle = useAnimatedStyle(() => ({ opacity: progress.value }), [progress])
  return (
    <View style={{ width: size, height: size }}>
      <Glyph size={size} color={color} strokeWidth={2} />
      <Animated.View
        testID="markdown-code-copy-tint"
        pointerEvents="none"
        style={[{ position: 'absolute', top: 0, left: 0, width: size, height: size }, tintStyle]}
      >
        <Glyph size={size} color={copiedColor} strokeWidth={2} />
      </Animated.View>
    </View>
  )
}
