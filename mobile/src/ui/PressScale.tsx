import { useCallback } from 'react'
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { triggerSelection } from '../platform/haptics'
import { PRESS_IN_SPRING, PRESS_OUT_SPRING } from './press-scale-motion'

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

export type PressScaleProps = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>
  /** Resting → pressed scale. */
  pressedScale?: number
  /** Dim while pressed, in addition to the scale. */
  pressedOpacity?: number
  haptic?: boolean
}

/** Spring-pressed surface (beUI Button feel): scales down on press-in and
 *  springs back on release. Disabled surfaces neither scale nor haptic. */
export function PressScale({
  style,
  pressedScale = 0.97,
  pressedOpacity = 1,
  haptic = false,
  disabled,
  onPressIn,
  onPressOut,
  ...rest
}: PressScaleProps) {
  const pressed = useSharedValue(0)
  const animatedStyle = useAnimatedStyle(
    () => ({
      transform: [{ scale: 1 - pressed.value * (1 - pressedScale) }],
      opacity: 1 - pressed.value * (1 - pressedOpacity)
    }),
    // Named so the mapper has inputs where no Babel closure is written (the web bundle).
    [pressed, pressedScale, pressedOpacity]
  )
  const handlePressIn = useCallback<NonNullable<PressableProps['onPressIn']>>(
    (event) => {
      if (!disabled) {
        pressed.value = withSpring(1, PRESS_IN_SPRING)
        if (haptic) {
          triggerSelection()
        }
      }
      onPressIn?.(event)
    },
    [disabled, haptic, onPressIn, pressed]
  )
  const handlePressOut = useCallback<NonNullable<PressableProps['onPressOut']>>(
    (event) => {
      pressed.value = withSpring(0, PRESS_OUT_SPRING)
      onPressOut?.(event)
    },
    [onPressOut, pressed]
  )
  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[style, animatedStyle]}
    />
  )
}
