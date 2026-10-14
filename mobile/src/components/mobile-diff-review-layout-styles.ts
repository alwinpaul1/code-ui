import { StyleSheet } from 'react-native'
import { radii, spacing, typography } from '../theme/mobile-theme'
import type { Theme } from '../theme/theme-context'

/** The diff review header/list/state layout, built from the live theme so the screen reads in
 *  light and in dark. Only the colours come from the theme; the sizes are the legacy scale's
 *  numbers, which are the same in both schemes. Callers take it through
 *  `useThemedStyles(mobileDiffReviewLayoutStyles)`. */
export function mobileDiffReviewLayoutStyles({ colors }: Theme) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.bg
    },
    header: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border
    },
    topBar: {
      minHeight: 50,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm
    },
    iconButton: {
      width: 44,
      height: 44,
      borderRadius: radii.button,
      alignItems: 'center',
      justifyContent: 'center'
    },
    iconButtonPressed: {
      backgroundColor: colors.bgRaised
    },
    titleBlock: {
      flex: 1,
      minWidth: 0
    },
    title: {
      color: colors.text,
      fontSize: typography.titleSize,
      fontWeight: '700'
    },
    subtitle: {
      color: colors.textMuted,
      fontSize: typography.metaSize,
      marginTop: 2
    },
    progressRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: spacing.md
    },
    progressText: {
      color: colors.textSecondary,
      fontSize: typography.metaSize,
      fontWeight: '600'
    },
    filterRow: {
      gap: spacing.sm,
      paddingTop: spacing.md,
      paddingBottom: spacing.xs
    },
    filterChip: {
      minHeight: 34,
      borderRadius: radii.button,
      paddingHorizontal: spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.bgPanel,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border
    },
    filterChipActive: {
      backgroundColor: colors.text,
      borderColor: colors.text
    },
    filterChipPressed: {
      opacity: 0.78
    },
    filterText: {
      color: colors.textSecondary,
      fontSize: typography.metaSize,
      fontWeight: '700'
    },
    filterTextActive: {
      color: colors.bg
    },
    fileHeader: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
      backgroundColor: colors.bg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border
    },
    fileTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm
    },
    statusBadge: {
      width: 28,
      height: 28,
      borderRadius: radii.button,
      borderWidth: StyleSheet.hairlineWidth,
      alignItems: 'center',
      justifyContent: 'center'
    },
    statusBadgeText: {
      fontSize: typography.metaSize,
      fontWeight: '800'
    },
    fileTitleBlock: {
      flex: 1,
      minWidth: 0
    },
    filePath: {
      color: colors.text,
      fontSize: typography.bodySize,
      fontWeight: '700'
    },
    fileMeta: {
      color: colors.textMuted,
      fontSize: typography.metaSize,
      marginTop: 2
    },
    fileMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.sm,
      flexWrap: 'wrap'
    },
    reviewedPill: {
      color: colors.success,
      fontSize: typography.metaSize,
      fontWeight: '700'
    },
    stalePill: {
      color: colors.warning,
      fontSize: typography.metaSize,
      fontWeight: '700'
    },
    staleText: {
      color: colors.warning,
      fontSize: typography.metaSize,
      fontWeight: '700'
    },
    fileNotes: {
      gap: spacing.xs,
      marginTop: spacing.sm
    },
    fileNote: {
      minHeight: 44,
      padding: spacing.sm,
      borderRadius: radii.button,
      backgroundColor: colors.bgPanel,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border
    },
    fileNotePressed: {
      backgroundColor: colors.bgRaised
    },
    fileNoteText: {
      color: colors.textSecondary,
      fontSize: typography.metaSize,
      lineHeight: 17
    },
    hunkRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.sm
    },
    hunkButton: {
      minHeight: 36,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      borderRadius: radii.button,
      backgroundColor: colors.bgPanel
    },
    hunkButtonPressed: {
      backgroundColor: colors.bgRaised
    },
    hunkButtonText: {
      color: colors.textSecondary,
      fontSize: typography.metaSize,
      fontWeight: '700'
    },
    actionError: {
      marginHorizontal: spacing.lg,
      marginTop: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radii.button,
      backgroundColor: colors.bgRaised,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.warning
    },
    actionErrorText: {
      color: colors.text,
      fontSize: typography.metaSize
    },
    diffList: {
      paddingBottom: 140,
      backgroundColor: colors.codeBg
    },
    truncatedText: {
      color: colors.textMuted,
      fontSize: typography.metaSize,
      padding: spacing.md,
      textAlign: 'center'
    },
    // The Claude app's diff states (`yc20.c`, com.anthropic.claude 1.261009.20): 32 dp around, a
    // 17 sp title in the primary colour, 15 sp centred text in the secondary one 8 dp under it,
    // and 16 dp between a spinner and its words.
    state: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 32,
      gap: spacing.sm
    },
    stateTitle: {
      color: colors.text,
      fontSize: 17,
      lineHeight: 22,
      fontWeight: '600',
      textAlign: 'center'
    },
    stateText: {
      color: colors.composerIcon,
      fontSize: 15,
      lineHeight: 21,
      textAlign: 'center'
    },
    stateTextBusy: {
      marginTop: spacing.sm
    },
    retryButton: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      borderRadius: radii.button,
      backgroundColor: colors.bgRaised
    },
    retryText: {
      color: colors.text,
      fontSize: typography.bodySize,
      fontWeight: '700'
    }
  })
}
