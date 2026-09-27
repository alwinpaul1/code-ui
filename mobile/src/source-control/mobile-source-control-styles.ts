import { StyleSheet } from 'react-native'
import { radii, spacing, typography } from '../theme/mobile-theme'
import type { Theme } from '../theme/theme-context'
import { diffStyles } from './mobile-source-control-diff-styles'
import { listStyles } from './mobile-source-control-list-styles'

function baseStyles({ colors }: Theme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg
    },
    header: {
      backgroundColor: colors.bgPanel,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border
    },
    topBar: {
      minHeight: 58,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.sm
    },
    backButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: spacing.xs
    },
    backButtonPressed: {
      backgroundColor: colors.bgRaised
    },
    titleBlock: {
      flex: 1,
      minWidth: 0
    },
    title: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '700'
    },
    meta: {
      color: colors.textSecondary,
      fontSize: typography.metaSize,
      marginTop: 2
    },
    refreshButton: {
      width: 36,
      height: 36,
      borderRadius: radii.button,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: spacing.xs
    },
    refreshButtonPressed: {
      backgroundColor: colors.bgRaised
    },
    refreshButtonDisabled: {
      opacity: 0.45
    },
    summaryCard: {
      margin: spacing.lg,
      marginBottom: spacing.sm,
      padding: spacing.md,
      borderRadius: radii.card,
      backgroundColor: colors.bgPanel,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border
    },
    summaryHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md
    },
    branchLine: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs
    },
    branchText: {
      flex: 1,
      color: colors.text,
      fontSize: typography.bodySize,
      fontWeight: '600'
    },
    syncText: {
      color: colors.textSecondary,
      fontSize: typography.metaSize
    },
    countRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.md,
      marginTop: spacing.sm
    },
    countText: {
      color: colors.textSecondary,
      fontSize: typography.metaSize
    },
    // Separate line under counts — keeps Abort inside the card on narrow phones.
    conflictRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.sm,
      alignSelf: 'flex-start',
      maxWidth: '100%'
    },
    conflictText: {
      color: colors.warning,
      fontSize: typography.metaSize,
      textTransform: 'capitalize'
    },
    // Match bulk-action hit target so Abort reads as a real control, not a chip.
    abortButton: {
      minHeight: 32,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radii.button,
      borderWidth: 1,
      borderColor: colors.warning,
      backgroundColor: colors.bgRaised,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    },
    abortPressed: {
      opacity: 0.75
    },
    abortButtonDisabled: {
      opacity: 0.45
    },
    abortText: {
      color: colors.warning,
      fontSize: typography.bodySize,
      fontWeight: '600',
      textTransform: 'capitalize'
    },
    reconnectBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginHorizontal: spacing.lg,
      marginTop: spacing.lg,
      marginBottom: -spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radii.button,
      backgroundColor: colors.bgRaised,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.warning
    },
    reconnectBannerText: {
      color: colors.text,
      fontSize: typography.metaSize
    },
    actionError: {
      marginTop: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radii.button,
      backgroundColor: colors.bgRaised,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.danger
    },
    actionErrorText: {
      color: colors.text,
      fontSize: typography.metaSize,
      lineHeight: 16
    },
    bulkRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.md
    },
    bulkButton: {
      flex: 1,
      minHeight: 36,
      borderRadius: radii.button,
      backgroundColor: colors.bgRaised,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: spacing.xs
    },
    bulkMenuButton: {
      width: 42,
      minHeight: 36,
      borderRadius: radii.button,
      backgroundColor: colors.bgRaised,
      alignItems: 'center',
      justifyContent: 'center'
    },
    bulkButtonDisabled: {
      opacity: 0.45
    },
    bulkButtonPressed: {
      opacity: 0.75
    },
    bulkButtonText: {
      color: colors.text,
      fontSize: typography.bodySize,
      fontWeight: '600'
    },
    createPrBlock: {
      marginTop: spacing.md
    },
    createPrButton: {
      height: 42,
      borderRadius: radii.button,
      backgroundColor: colors.text,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: spacing.xs,
      paddingHorizontal: spacing.md
    },
    createPrButtonDisabled: {
      backgroundColor: colors.bgRaised,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border
    },
    createPrButtonPressed: {
      opacity: 0.78
    },
    createPrButtonText: {
      color: colors.bg,
      fontSize: typography.bodySize,
      fontWeight: '700'
    },
    createPrButtonTextDisabled: {
      color: colors.textSecondary
    },
    createPrButtonHint: {
      fontSize: typography.metaSize,
      fontWeight: '600',
      lineHeight: 16,
      textAlign: 'center',
      flexShrink: 1
    }
  })
}

/** The source control hub's own styles, merged with its list and diff sub-sheets, built from the
 *  live theme so the whole screen reads in light and in dark. Callers take it through
 *  `useThemedStyles(sourceControlStyles)`. */
export function sourceControlStyles(theme: Theme) {
  return { ...baseStyles(theme), ...listStyles(theme), ...diffStyles(theme) }
}
