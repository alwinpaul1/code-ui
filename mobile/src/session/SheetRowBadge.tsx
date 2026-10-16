import { View } from 'react-native'
import { claudePickerPalette } from '../theme/claude-picker-palette'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'

/** A pill after a sheet row's title, as the Claude app draws a row's `badge` (w8m.java:11-46):
 *  fully round, 8 dp by 2 dp of padding, the caption size. */
export type SheetRowBadgeSpec = { text: string; tone: 'neutral' | 'warning' }

export function SheetRowBadge({ badge }: { badge: SheetRowBadgeSpec }): React.JSX.Element {
  const { scheme } = useTheme()
  const palette = claudePickerPalette(scheme)
  const warning = badge.tone === 'warning'
  return (
    <View
      style={{
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 2,
        backgroundColor: warning ? palette.badgeWarningFill : palette.badgeNeutralFill
      }}
    >
      <Txt
        variant="caption"
        weight="medium"
        numberOfLines={1}
        style={{ color: warning ? palette.badgeWarningText : palette.badgeNeutralText }}
      >
        {badge.text}
      </Txt>
    </View>
  )
}
