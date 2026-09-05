import type { LucideIcon } from 'lucide-react-native'
import { ActivityIndicator, type StyleProp, type ViewStyle } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { PressScale } from './PressScale'
import { Txt } from './Txt'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent'

/** Text button. `primary` is ink-on-cream (Claude app), `accent` is terracotta. */
export function Button({
  label,
  onPress,
  icon: Icon,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  block = false,
  accessibilityLabel,
  style
}: {
  label: string
  onPress?: () => void
  icon?: LucideIcon
  variant?: Variant
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  loading?: boolean
  block?: boolean
  accessibilityLabel?: string
  style?: StyleProp<ViewStyle>
}) {
  const { colors, radius, space } = useTheme()
  const background = {
    primary: colors.text,
    secondary: colors.bgRaised,
    ghost: 'transparent',
    danger: colors.danger,
    accent: colors.accent
  }[variant]
  const foreground = {
    primary: colors.textInverse,
    secondary: colors.text,
    ghost: colors.text,
    danger: '#FFFFFF',
    accent: colors.onAccent
  }[variant]
  const height = { sm: 36, md: 44, lg: 52 }[size]
  return (
    <PressScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      pressedScale={0.97}
      style={[
        {
          height,
          paddingHorizontal: size === 'sm' ? space.md : space.lg + 4,
          borderRadius: radius.pill,
          backgroundColor: background,
          borderWidth: variant === 'secondary' ? 1 : 0,
          borderColor: colors.border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.sm,
          alignSelf: block ? 'stretch' : 'flex-start',
          opacity: disabled ? 0.5 : 1
        },
        style
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={foreground} />
      ) : Icon ? (
        <Icon size={size === 'sm' ? 14 : 17} color={foreground} strokeWidth={2.2} />
      ) : null}
      <Txt
        variant={size === 'sm' ? 'label' : 'body'}
        weight="semibold"
        style={{ color: foreground }}
      >
        {label}
      </Txt>
    </PressScale>
  )
}
