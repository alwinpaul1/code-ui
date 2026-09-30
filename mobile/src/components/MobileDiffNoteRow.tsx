import { StyleSheet, Text, View } from 'react-native'
import type { MobileDiffLine } from '../session/mobile-diff-lines'
import { spacing, typography } from '../theme/mobile-theme'
import { useThemedStyles } from '../theme/theme-context'
import type { Theme } from '../theme/theme-context'

/**
 * A diff row that stands for something other than a line of the file (`line.note`): unchanged
 * lines folded away, or what the mobile cap left out. Drawn as plain text on its own band, not as
 * code, with no line number and nothing to tap, so it cannot be mistaken for a line or noted on.
 */
export function MobileDiffNoteRow({ line }: { line: MobileDiffLine }) {
  const styles = useThemedStyles(diffNoteRowStyles)
  return (
    <View style={styles.row} accessible accessibilityLabel={line.text}>
      <Text style={styles.text}>{line.text}</Text>
    </View>
  )
}

function diffNoteRowStyles({ colors }: Theme) {
  return StyleSheet.create({
    row: {
      paddingVertical: 2,
      paddingHorizontal: spacing.md,
      backgroundColor: colors.bgSunken,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border
    },
    text: {
      color: colors.textMuted,
      fontFamily: typography.monoFamily,
      fontSize: typography.metaSize,
      fontStyle: 'italic',
      lineHeight: 18
    }
  })
}
