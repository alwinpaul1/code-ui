import { StyleSheet } from 'react-native'
import { radii, spacing, typography } from '../theme/mobile-theme'
import type { Theme } from '../theme/theme-context'
import { TEXT_INPUT_FONT_SIZE } from '../platform/text-input-font-size'

/** Changed-files list, section headers, file rows, and the commit bar, built from the live theme
 *  so they read in light and in dark. Split from the main source-control stylesheet to stay
 *  under the line limit. Callers take it through `useThemedStyles(listStyles)`. */
export function listStyles({ colors }: Theme) {
  return StyleSheet.create({
    listContent: {
      paddingHorizontal: spacing.lg,
      paddingBottom: 136
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: spacing.md,
      paddingBottom: spacing.xs
    },
    sectionTitle: {
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase'
    },
    sectionCount: {
      color: colors.textMuted,
      fontSize: typography.metaSize,
      fontWeight: '600'
    },
    branchCompareBlock: {
      paddingBottom: spacing.sm
    },
    branchSectionTitleBlock: {
      flex: 1,
      minWidth: 0
    },
    branchSectionSubtitle: {
      color: colors.textMuted,
      fontSize: typography.metaSize,
      marginTop: 2
    },
    branchStateRow: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border
    },
    branchStateText: {
      flex: 1,
      color: colors.textSecondary,
      fontSize: typography.metaSize,
      lineHeight: 18
    },
    fileRow: {
      minHeight: 50,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border
    },
    fileRowPressed: {
      backgroundColor: colors.bgPanel
    },
    fileRowDisabled: {
      opacity: 0.78
    },
    fileRowUnavailable: {
      opacity: 0.72
    },
    statusBadge: {
      width: 24,
      alignItems: 'center'
    },
    statusBadgeText: {
      fontFamily: typography.monoFamily,
      fontSize: typography.metaSize,
      fontWeight: '700'
    },
    fileTextBlock: {
      flex: 1,
      minWidth: 0
    },
    filePath: {
      color: colors.text,
      fontSize: typography.bodySize
    },
    filePathDisabled: {
      color: colors.textSecondary
    },
    fileMeta: {
      color: colors.textMuted,
      fontSize: typography.metaSize,
      marginTop: 2
    },
    rowActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs
    },
    iconButton: {
      width: 32,
      height: 32,
      borderRadius: radii.button,
      alignItems: 'center',
      justifyContent: 'center'
    },
    iconButtonPressed: {
      backgroundColor: colors.bgRaised
    },
    iconButtonDisabled: {
      opacity: 0.45
    },
    commitBar: {
      position: 'absolute',
      left: 0,
      right: 0,
      gap: spacing.xs,
      padding: spacing.lg,
      paddingTop: spacing.md,
      backgroundColor: colors.bgPanel,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border
    },
    commitRow: {
      flexDirection: 'row',
      gap: spacing.sm
    },
    commitInput: {
      flex: 1,
      minHeight: 42,
      borderRadius: radii.input,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.bg,
      color: colors.text,
      paddingHorizontal: spacing.md,
      // Through the seam: on the web this must clear the size at which iOS zooms the page on focus.
      fontSize: TEXT_INPUT_FONT_SIZE
    },
    commitInputDisabled: {
      backgroundColor: colors.bgPanel,
      borderColor: colors.border,
      borderStyle: 'dashed',
      alignItems: 'center',
      justifyContent: 'center'
    },
    commitInputDisabledText: {
      color: colors.textMuted,
      fontSize: typography.bodySize,
      fontWeight: '600'
    },
    commitButton: {
      minWidth: 88,
      minHeight: 42,
      borderRadius: radii.button,
      backgroundColor: colors.text,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.md
    },
    commitButtonSecondary: {
      backgroundColor: 'transparent',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border
    },
    generateButton: {
      width: 42,
      minHeight: 42,
      borderRadius: radii.button,
      backgroundColor: colors.bgRaised,
      alignItems: 'center',
      justifyContent: 'center'
    },
    commitButtonDisabled: {
      opacity: 0.45
    },
    commitButtonPressed: {
      opacity: 0.75
    },
    commitButtonText: {
      color: colors.bg,
      fontSize: typography.bodySize,
      fontWeight: '700'
    },
    commitButtonSecondaryText: {
      color: colors.text
    },
    commitFailurePanel: {
      marginTop: spacing.sm,
      padding: spacing.sm,
      borderRadius: radii.button,
      backgroundColor: colors.bgRaised,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.danger,
      gap: spacing.sm
    },
    commitFailureHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm
    },
    commitFailureTextBlock: {
      flex: 1,
      minWidth: 0
    },
    commitFailureTitle: {
      color: colors.text,
      fontSize: typography.bodySize,
      fontWeight: '700'
    },
    commitFailureSummary: {
      color: colors.textSecondary,
      fontSize: typography.metaSize,
      lineHeight: 16,
      marginTop: 2
    },
    commitFailureFixButton: {
      minHeight: 36,
      paddingHorizontal: spacing.md,
      borderRadius: radii.button,
      backgroundColor: colors.text,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs
    },
    commitFailureFixButtonDisabled: {
      opacity: 0.45
    },
    commitFailureFixButtonPressed: {
      opacity: 0.75
    },
    commitFailureFixButtonText: {
      color: colors.bg,
      fontSize: typography.metaSize,
      fontWeight: '700'
    },
    commitFailureDetailsButton: {
      minHeight: 32,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs
    },
    commitFailureDetailsButtonPressed: {
      opacity: 0.75
    },
    commitFailureDetailsButtonText: {
      color: colors.textSecondary,
      fontSize: typography.metaSize,
      fontWeight: '600'
    },
    commitFailureDetailsText: {
      color: colors.textSecondary,
      fontFamily: typography.monoFamily,
      fontSize: typography.metaSize,
      lineHeight: 17
    },
    commitFailureLaunchError: {
      color: colors.danger,
      fontSize: typography.metaSize,
      lineHeight: 16
    }
  })
}
