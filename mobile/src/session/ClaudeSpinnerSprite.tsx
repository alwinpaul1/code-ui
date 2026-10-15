import { useEffect, useState } from 'react'
import { Image, View } from 'react-native'
import spriteSource from '../../assets/claude-spinner-sprite.webp'
import { useReducedMotion } from '../ui/use-reduced-motion'
import { CLAUDE_SPINNER, nextSpinnerFrame } from './claude-working-footer-spec'

/**
 * The Claude app's spinner beside its working line: `cc_spinner_sprite`, 84 frames of an asterisk
 * that opens, blooms and closes, played at 60 ms a frame, 16 dp square, tinted (see
 * claude-working-footer-spec.ts for the lines in the decompiled app). It replaces the
 * breathing starburst the line used to draw.
 *
 * The sprite is a tall strip; a square window shows one frame and the strip slides under it. The
 * frame is plain state advanced by a timer, which is cheap at 16 a second for one 16 dp image.
 *
 * Reduced motion: the app plays the frames whatever the OS says; here the spinner holds on the
 * star at rest (frame 4, the one the app shows when nothing works), also while the answer is not
 * known yet, as every decorative loop does (use-reduced-motion.ts).
 */
export function ClaudeSpinnerSprite({ color, animating }: { color: string; animating: boolean }) {
  const reducedMotion = useReducedMotion()
  const still = !animating || reducedMotion !== false
  const [frame, setFrame] = useState(CLAUDE_SPINNER.restFrame)
  useEffect(() => {
    if (still) {
      setFrame(CLAUDE_SPINNER.restFrame)
      return undefined
    }
    setFrame(0)
    const timer = setInterval(() => setFrame(nextSpinnerFrame), CLAUDE_SPINNER.frameMs)
    return () => clearInterval(timer)
  }, [still])
  const { size, frames } = CLAUDE_SPINNER
  return (
    <View
      style={{ width: size, height: size, overflow: 'hidden' }}
      testID="claude-spinner-sprite"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <Image
        source={spriteSource}
        resizeMode="stretch"
        fadeDuration={0}
        style={{ width: size, height: size * frames, tintColor: color, transform: [{ translateY: -frame * size }] }}
        testID="claude-spinner-sprite-strip"
      />
    </View>
  )
}
