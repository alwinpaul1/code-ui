import type { LucideIcon } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { View, type StyleProp, type ViewStyle } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { PressScale } from './PressScale'
import { Txt } from './Txt'

/** Rounded pill for filters, tabs, models and status. Selected pills invert. */
export function Chip({
  label,
  icon: Icon,
  leading,
  selected = false,
  disabled = false,
  onPress,
  onLongPress,
  accessibilityLabel,
  size = 'md',
  style,
  tone
}: {
  label: string
  icon?: LucideIcon
  /** Custom leading node when an icon is not enough (agent glyph, dot). */
  leading?: ReactNode
  selected?: boolean
  disabled?: boolean
  onPress?: () => void
  onLongPress?: () => void
  accessibilityLabel?: string
  size?: 'sm' | 'md'
  style?: StyleProp<ViewStyle>
  /** Label color override for status chips. */
  tone?: string
}) {
  const { colors, radius, space } = useTheme()
  const height = size === 'sm' ? 28 : 34
  const content = (
    <>
      {leading}
      {Icon ? (
        <Icon
          size={size === 'sm' ? 12 : 14}
          color={tone ?? (selected ? colors.textInverse : colors.textSecondary)}
          strokeWidth={2.2}
        />
      ) : null}
      <Txt
        variant={size === 'sm' ? 'caption' : 'label'}
        weight="medium"
        numberOfLines={1}
        style={{ color: tone ?? (selected ? colors.textInverse : colors.text) }}
      >
        {label}
      </Txt>
    </>
  )
  const surface: ViewStyle = {
    height,
    paddingHorizontal: size === 'sm' ? space.sm + 2 : space.md,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: selected ? colors.text : colors.bgRaised,
    borderWidth: selected ? 0 : 1,
    borderColor: colors.border,
    opacity: disabled ? 0.5 : 1
  }
  if (!onPress && !onLongPress) {
    return <View style={[surface, style]}>{content}</View>
  }
  return (
    <PressScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      pressedScale={0.95}
      style={[surface, style]}
    >
      {content}
    </PressScale>
  )
}
