import { View, type ViewProps } from 'react-native'
import { useTheme } from '../theme/theme-context'

type Level = 'panel' | 'raised' | 'sunken' | 'canvas'

/** A themed container: card, well, or sheet body. */
export function Surface({
  level = 'panel',
  bordered = level === 'panel',
  padded = false,
  rounded = 'md',
  style,
  ...rest
}: ViewProps & {
  level?: Level
  bordered?: boolean
  padded?: boolean | number
  rounded?: 'sm' | 'md' | 'lg' | 'xl' | 'none'
}) {
  const { colors, radius, space } = useTheme()
  const background = {
    panel: colors.bgPanel,
    raised: colors.bgRaised,
    sunken: colors.bgSunken,
    canvas: colors.bg
  }[level]
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: background,
          borderRadius: rounded === 'none' ? 0 : radius[rounded],
          borderWidth: bordered ? 1 : 0,
          borderColor: colors.border,
          padding: padded === true ? space.lg : padded === false ? 0 : padded
        },
        style
      ]}
    />
  )
}
