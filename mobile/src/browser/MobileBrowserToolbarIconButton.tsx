import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import { tapTargetHitSlop } from '../ui/tap-target'
import type { ReactNode } from 'react'
import { colors, radii, spacing } from '../theme/mobile-theme'

type Props = {
  children: ReactNode
  disabled?: boolean
  label: string
  onPress: () => void
  style?: StyleProp<ViewStyle>
}

export function MobileBrowserToolbarIconButton({
  children,
  disabled,
  label,
  onPress,
  style
}: Props): React.JSX.Element {
  return (
    <Pressable
      // The toolbar sets `gap: spacing.xs`, so the slop stops halfway across it:
      // without the cap, Forward’s target would cover the right 5 dp of the
      // Back button a user can see, and tapping Back would navigate forward.
      hitSlop={tapTargetHitSlop(styles.button, { horizontalGap: spacing.xs })}
      style={({ pressed }) => [
        styles.button,
        style,
        pressed && !disabled && styles.buttonPressed,
        disabled && styles.disabled
      ]}
      disabled={disabled}
      onPress={onPress}
      accessibilityLabel={label}
    >
      {children}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    width: 26,
    height: 26,
    borderRadius: radii.button,
    alignItems: 'center',
    justifyContent: 'center'
  },
  buttonPressed: {
    backgroundColor: colors.bgRaised
  },
  disabled: {
    opacity: 0.35
  }
})
