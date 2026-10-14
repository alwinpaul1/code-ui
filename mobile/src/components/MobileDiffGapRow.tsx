import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ChevronDown, ChevronUp, UnfoldVertical } from 'lucide-react-native'
import {
  mobileDiffPaletteForScheme,
  MOBILE_DIFF_TYPE
} from '../source-control/mobile-diff-claude-palette'
import {
  MOBILE_DIFF_EXPAND_LABELS,
  mobileDiffGapLabel,
  type MobileDiffExpandDirection
} from '../source-control/mobile-diff-expand'
import { spacing, typography } from '../theme/mobile-theme'
import { useTheme, useThemedStyles } from '../theme/theme-context'
import type { Theme } from '../theme/theme-context'

type Props = {
  /** Lines the fold hides; 0 reads "Expand", as the app's does when it has no count. */
  hiddenLines: number
  /** The one control the fold offers, or null for a fold whose lines are not in the rows. */
  action: MobileDiffExpandDirection | null
  /** A line's gutter width, so the arrow sits in the same column as the numbers. */
  gutterWidth: number
  onExpand?: (direction: MobileDiffExpandDirection) => void
  /** What an inert fold reads as to a screen reader, where "+N lines" alone would not say enough. */
  accessibilityLabel?: string
}

const ARROW_SIZE = 20

/**
 * The fold between two hunks (`jlc.e` in com.anthropic.claude 1.261009.20): a gutter cell in one
 * blue holding a 20 dp arrow, then a label cell in a second blue reading "+N lines". The row is one
 * tap target, or plain text when the hidden lines cannot be brought back.
 */
export function MobileDiffGapRow({
  hiddenLines,
  action,
  gutterWidth,
  onExpand,
  accessibilityLabel
}: Props) {
  const { colors } = useTheme()
  const styles = useThemedStyles(diffGapRowStyles)
  const label = mobileDiffGapLabel({ hiddenLines })
  const Arrow = action === 'up' ? ChevronUp : action === 'down' ? ChevronDown : UnfoldVertical
  const row = (
    <>
      <View style={[styles.gutterCell, { width: gutterWidth }]}>
        {action === null ? null : (
          <Arrow size={ARROW_SIZE} color={colors.composerPlaceholder} strokeWidth={2} />
        )}
      </View>
      <View style={styles.labelCell}>
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </>
  )
  if (action === null) {
    return (
      <View style={styles.row} accessible accessibilityLabel={accessibilityLabel ?? label}>
        {row}
      </View>
    )
  }
  return (
    <Pressable
      style={styles.row}
      onPress={() => onExpand?.(action)}
      accessibilityRole="button"
      accessibilityLabel={`${MOBILE_DIFF_EXPAND_LABELS[action]}, ${label}`}
    >
      {row}
    </Pressable>
  )
}

function diffGapRowStyles({ colors, scheme }: Theme) {
  const palette = mobileDiffPaletteForScheme(scheme)
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'stretch'
    },
    gutterCell: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.xs,
      backgroundColor: palette.gapGutterBg
    },
    labelCell: {
      flex: 1,
      minWidth: 0,
      justifyContent: 'center',
      paddingLeft: spacing.sm,
      paddingVertical: spacing.xs,
      backgroundColor: palette.gapBg
    },
    label: {
      color: colors.composerPlaceholder,
      fontFamily: typography.monoFamily,
      fontSize: MOBILE_DIFF_TYPE.gapLabelSize,
      lineHeight: MOBILE_DIFF_TYPE.lineHeight
    }
  })
}
