import { StyleSheet } from 'react-native'
import { radii, spacing, typography } from '../theme/mobile-theme'
import type { Theme } from '../theme/theme-context'

export function fileExplorerStyles({ colors }: Theme) {
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
      gap: spacing.md,
      paddingHorizontal: spacing.md
    },
    backButton: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.button
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
      fontSize: typography.titleSize,
      fontWeight: '600'
    },
    meta: {
      marginTop: 2,
      color: colors.textSecondary,
      fontSize: typography.metaSize
    },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginHorizontal: spacing.md,
      marginBottom: spacing.sm,
      paddingHorizontal: spacing.sm + 2,
      height: 38,
      borderRadius: radii.button,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bgRaised
    },
    searchInput: {
      flex: 1,
      height: 38,
      paddingVertical: 0,
      color: colors.text,
      fontSize: typography.metaSize + 2
    },
    searchClear: {
      width: 28,
      height: 28,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 14
    },
    searchResultRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      minHeight: 48
    },
    searchResultName: {
      color: colors.text,
      fontSize: typography.bodySize
    },
    searchResultDir: {
      marginTop: 1,
      color: colors.textSecondary,
      fontSize: typography.metaSize
    },
    list: { flex: 1 },
    listContent: {
      paddingVertical: spacing.sm
    },
    row: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingRight: spacing.md
    },
    rowPressed: {
      backgroundColor: colors.bgRaised
    },
    rowDisabled: {
      opacity: 0.58
    },
    chevronSpacer: {
      width: 16
    },
    rowTextBlock: {
      flex: 1,
      minWidth: 0
    },
    rowTitle: {
      color: colors.text,
      fontSize: typography.bodySize
    },
    rowTitleDisabled: {
      color: colors.textMuted
    },
    rowMeta: {
      marginTop: 1,
      color: colors.textMuted,
      fontSize: 11
    },
    inlineStatusRow: {
      minHeight: 36,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingRight: spacing.md
    },
    inlineStatusText: {
      color: colors.textSecondary,
      fontSize: typography.metaSize
    },
    inlineErrorText: {
      flex: 1,
      minWidth: 0,
      color: colors.danger,
      fontSize: typography.metaSize
    },
    inlineRetryButton: {
      minHeight: 28,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.button,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingHorizontal: spacing.md
    },
    inlineRetryText: {
      color: colors.text,
      fontSize: typography.metaSize,
      fontWeight: '600'
    },
    state: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.md,
      padding: spacing.xl
    },
    emptyText: {
      color: colors.textSecondary,
      fontSize: typography.bodySize
    },
    errorText: {
      color: colors.danger,
      fontSize: typography.bodySize,
      textAlign: 'center'
    },
    retryButton: {
      minHeight: 36,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.button,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingHorizontal: spacing.lg
    },
    retryText: {
      color: colors.text,
      fontSize: typography.bodySize,
      fontWeight: '600'
    }
  })
}
