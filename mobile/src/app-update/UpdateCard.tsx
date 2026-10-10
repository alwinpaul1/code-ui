import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Animated, Easing, LayoutAnimation } from 'react-native'

import { useTheme } from '../theme/theme-context'
import {
  ALERT_CROSSFADE_MS,
  ALERT_SPRING,
  alertScaleRange,
  springFromAppleParams
} from '../ui/alert/alert-motion'
import { useAlertMotion } from '../ui/alert/use-alert-motion'

/** The card fills the phone's width less the wrapper's gutter, up to this, so
 *  on a tablet or a landscape phone it stays a card and not a banner. */
export const UPDATE_CARD_MAX_WIDTH = 400

type Props = {
  children: ReactNode
  /** Change it and the card's height eases to the new content rather than
   *  snapping (the "morph" between an alert's states). */
  morphKey?: string
}

/**
 * The update card (2026-10-10 redesign: "not glass, premium and modern"). A
 * SOLID panel, no translucency and no blur: the panel colour, a 1px border
 * and a soft shadow give it its elevation in both schemes. Up to 400
 * wide with a 24 corner. It materialises on a critically damped spring, scale
 * and opacity on the same value so it arrives as one surface rather than
 * fading in place. Under reduced motion the scale range collapses to 1 and the reveal is a short
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
export function UpdateCard({ children, morphKey }: Props) {
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
        width: '100%',
        maxWidth: UPDATE_CARD_MAX_WIDTH,
        // Never taller than the wrapper that centres it, so on a small screen
        // or at a large font size the column inside shrinks (its scroll
        // region gives way) and the action bar stays on screen.
        maxHeight: '100%',
        borderRadius: radius.xl,
        // So a pressed button and the scrolling notes are clipped to the corners.
        overflow: 'hidden',
        // Opaque, from the theme: nothing of the page shows through.
        backgroundColor: colors.bgPanel,
        borderWidth: 1,
        borderColor: colors.border,
        shadowColor: colors.shadow,
        shadowOpacity: 1,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 12 },
        elevation: 12,
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
