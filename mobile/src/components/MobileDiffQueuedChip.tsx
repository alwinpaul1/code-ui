import { Pressable, StyleSheet, Text } from 'react-native'
import { MessageSquare } from 'lucide-react-native'
import { mobileDiffPaletteForScheme } from '../source-control/mobile-diff-claude-palette'
import { tapTargetHitSlop } from '../ui/tap-target'
import { spacing } from '../theme/mobile-theme'
import { useTheme, useThemedStyles } from '../theme/theme-context'
import type { Theme } from '../theme/theme-context'

type Props = {
  /** Comments written and not yet sent. */
  count: number
  onPress: () => void
}

/**
 * How many comments are waiting to be sent, as the Claude app's chip says it (`o330.b` in
 * com.anthropic.claude 1.261009.20): a pill with 16 dp corners in the primary text colour at 10%,
 * 10 dp across and 6 dp down, a 14 dp bubble in the secondary colour, 4 dp, then "N comment(s)" in
 * 13 sp (`diff_comments_chip_text`). A screen reader gets `diff_comments_chip_description` word
 * for word. Not drawn for none.
 */
export function MobileDiffQueuedChip({ count, onPress }: Props) {
  const { colors } = useTheme()
  const styles = useThemedStyles(queuedChipStyles)
  if (count <= 0) {
    return null
  }
  return (
    <Pressable
      hitSlop={tapTargetHitSlop(styles.chip)}
      style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${count} queued comments, tap to view`}
    >
      <MessageSquare size={14} color={colors.composerIcon} strokeWidth={2} />
      <Text style={styles.label}>{count === 1 ? '1 comment' : `${count} comments`}</Text>
    </Pressable>
  )
}

function queuedChipStyles({ colors, scheme }: Theme) {
  return StyleSheet.create({
    chip: {
      // The pill's own height (6 + 18 + 6), stated so the tap target can be grown to 44.
      minHeight: 30,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 16,
      backgroundColor: mobileDiffPaletteForScheme(scheme).chipBg
    },
    chipPressed: {
      opacity: 0.72
    },
    label: {
      color: colors.composerIcon,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '600'
    }
  })
}
