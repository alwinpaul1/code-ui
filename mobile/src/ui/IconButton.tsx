import type { LucideIcon } from 'lucide-react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { PressScale } from './PressScale'

type Variant = 'ghost' | 'soft' | 'filled' | 'outline'

export function IconButton({
  icon: Icon,
  onPress,
  onLongPress,
  accessibilityLabel,
  size = 40,
  iconSize,
  variant = 'ghost',
  active = false,
  disabled = false,
  tone,
  style,
  testID
}: {
  icon: LucideIcon
  onPress?: () => void
  onLongPress?: () => void
  accessibilityLabel: string
  size?: number
  iconSize?: number
  variant?: Variant
  /** Highlights the button as the current panel/mode. */
  active?: boolean
  disabled?: boolean
  /** Icon color override, else derived from variant. */
  tone?: string
  style?: StyleProp<ViewStyle>
  testID?: string
}) {
  const { colors, radius } = useTheme()
  const background =
    variant === 'filled'
      ? colors.text
      : variant === 'soft' || active
        ? colors.bgRaised
        : 'transparent'
  const iconColor =
    tone ??
    (variant === 'filled'
      ? colors.textInverse
      : active
        ? colors.text
        : disabled
          ? colors.textMuted
          : colors.textSecondary)
  return (
    <PressScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      hitSlop={8}
      pressedScale={0.92}
      pressedOpacity={0.85}
      testID={testID}
      style={[
        {
          width: size,
          height: size,
          borderRadius: radius.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: background,
          borderWidth: variant === 'outline' ? 1 : 0,
          borderColor: colors.border,
          opacity: disabled ? 0.5 : 1
        },
        style
      ]}
    >
      <Icon size={iconSize ?? Math.round(size * 0.5)} color={iconColor} strokeWidth={2} />
    </PressScale>
  )
}
