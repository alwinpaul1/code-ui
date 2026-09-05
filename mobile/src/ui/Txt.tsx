import { Text, type TextProps, type TextStyle } from 'react-native'
import type { FontWeight } from '../theme/tokens'
import { useTheme } from '../theme/theme-context'
import type { TypeVariant } from '../theme/tokens'

export type TxtTone =
  | 'primary'
  | 'secondary'
  | 'muted'
  | 'accent'
  | 'danger'
  | 'success'
  | 'warning'
  | 'inverse'
  | 'onAccent'

export type TxtProps = TextProps & {
  variant?: TypeVariant
  weight?: FontWeight
  tone?: TxtTone
  /** Multiplies size and line height (pinch-to-zoom, accessibility). */
  scale?: number
  align?: TextStyle['textAlign']
}

/** The one Text. Instrument Sans for everything except `mono`. */
export function Txt({
  variant = 'body',
  weight = 'regular',
  tone = 'primary',
  scale = 1,
  align,
  style,
  ...rest
}: TxtProps) {
  const { colors, fonts, type } = useTheme()
  const spec = type[variant]
  const color = {
    primary: colors.text,
    secondary: colors.textSecondary,
    muted: colors.textMuted,
    accent: colors.accentText,
    danger: colors.danger,
    success: colors.success,
    warning: colors.warning,
    inverse: colors.textInverse,
    onAccent: colors.onAccent
  }[tone]
  return (
    <Text
      {...rest}
      style={[
        {
          fontFamily: variant === 'mono' ? fonts.mono : fonts[weight],
          fontSize: spec.size * scale,
          lineHeight: spec.lineHeight * scale,
          letterSpacing: spec.letterSpacing,
          color,
          textAlign: align
        },
        style
      ]}
    />
  )
}
