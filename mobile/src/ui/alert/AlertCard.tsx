import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Animated, Easing, LayoutAnimation, StyleSheet } from 'react-native'

import { useTheme } from '../../theme/theme-context'
import { ALERT_CROSSFADE_MS, ALERT_SPRING, alertScaleRange, springFromAppleParams } from './alert-motion'
import { useAlertMotion } from './use-alert-motion'

/** UIAlertController's card: 270 wide whatever the screen, never full-bleed. */
export const ALERT_CARD_WIDTH = 270

type Props = {
  children: ReactNode
  /** Change it and the card's height eases to the new content rather than
   *  snapping (the "morph" between an alert's states). */
  morphKey?: string
}

/**
 * The card of a system-style alert: a fixed 270 material with a 14 corner
 * that materialises on a critically damped spring, scale and opacity on the
 * same value so it arrives as one surface rather than fading in place. Under
 * reduced motion the scale range collapses to 1 and the reveal is a short
 * timing: a cross-fade, no travel, no overshoot.
 *
 * It holds at reveal 0 until `useAlertMotion` has an answer, so the OS's
 * reduced-motion setting decides the FIRST frame too; the hook answers within
 * a beat even when the OS does not.
 *
 * There is deliberately no exit path. A card that fades out over the screen
 * it covered was recorded reading as a press on the row beneath it (Galaxy
 * S23, 0.3.2, pinned in use-app-update-touch-shield.test.ts), so the caller
 * unmounts the card the instant the alert closes and only the caller's
 * touch shield outlives it. The scrim behind the card is the caller's, and it
 * is never animated either: native-driver opacity on a window-filling view let
 * a held press fall through the Modal on the same phone.
 */
export function AlertCard({ children, morphKey }: Props) {
  const { colors, radius } = useTheme()
  const motion = useAlertMotion()
  const reveal = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (motion === null) {
      return undefined
    }
    const animation =
      motion === 'crossfade'
        ? Animated.timing(reveal, {
            toValue: 1,
            duration: ALERT_CROSSFADE_MS,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true
          })
        : Animated.spring(reveal, {
            toValue: 1,
            ...springFromAppleParams(ALERT_SPRING),
            useNativeDriver: true
          })
    animation.start()
    return () => animation.stop()
  }, [motion, reveal])

  // Why during render: LayoutAnimation must be configured before the commit
  // that changes the height, and this is the render that sees the new key.
  const [previousMorphKey, setPreviousMorphKey] = useState(morphKey)
  if (previousMorphKey !== morphKey) {
    setPreviousMorphKey(morphKey)
    // Only once the OS has said motion is NOT reduced. `null` (not yet
    // answered) must not animate either: the card is held still in that
    // window, and so is its height (review, 2026-09-17).
    if (motion === 'spring') {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    }
  }

  return (
    <Animated.View
      accessibilityViewIsModal
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        width: ALERT_CARD_WIDTH,
        // Never taller than the wrapper that centres it, so on a small screen
        // or at a large font size the column inside shrinks (its scroll
        // region gives way) and the action rows stay on screen.
        maxHeight: '100%',
        // radius.md is 14, UIAlertController's corner.
        borderRadius: radius.md,
        // So a pressed bottom row is clipped to the corners.
        overflow: 'hidden',
        backgroundColor: colors.alertMaterial,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        opacity: reveal,
        transform: [
          {
            scale: reveal.interpolate({
              inputRange: [0, 1],
              outputRange: alertScaleRange(motion ?? 'spring')
            })
          }
        ]
      }}
    >
      {children}
    </Animated.View>
  )
}
