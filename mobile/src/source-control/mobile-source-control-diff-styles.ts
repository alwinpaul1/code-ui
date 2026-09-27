import { StyleSheet } from 'react-native'
import { radii, spacing, typography } from '../theme/mobile-theme'
import type { Theme } from '../theme/theme-context'

/** Empty-state, retry, and committed-diff-preview drawer styles, built from the live theme so
 *  the panel reads in light and in dark. Split from the main source-control stylesheet to stay
 *  under the line limit. Callers take it through `sourceControlStyles`'s merge. */
export function diffStyles({ colors }: Theme) {
  return StyleSheet.create({
    state: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xl
    },
    /** Fills the scroller that carries pull-to-refresh, so an empty state is
     *  still tall enough to pull on. */
    stateScrollContent: {
      flexGrow: 1
    },
    stateTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
      marginBottom: spacing.xs
    },
    stateText: {
      color: colors.textSecondary,
      fontSize: typography.bodySize,
      lineHeight: 20,
      textAlign: 'center'
    },
    retryButton: {
      marginTop: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radii.button,
      backgroundColor: colors.bgRaised
    },
    retryText: {
      color: colors.text,
      fontSize: typography.bodySize,
      fontWeight: '600'
    },
    diffDrawerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingBottom: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border
    },
    diffDrawerTitleBlock: {
      flex: 1,
      minWidth: 0
    },
    diffDrawerTitle: {
      color: colors.text,
      fontSize: typography.bodySize,
      fontWeight: '700'
    },
    diffDrawerMeta: {
      color: colors.textMuted,
      fontSize: typography.metaSize,
      marginTop: 2
    },
    diffCloseButton: {
      width: 34,
      height: 34,
      borderRadius: radii.button,
      alignItems: 'center',
      justifyContent: 'center'
    },
    diffState: {
      minHeight: 160,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.lg
    },
    diffLines: {
      paddingTop: spacing.md,
      paddingBottom: spacing.lg
    },
    diffTruncatedText: {
      color: colors.textMuted,
      fontSize: typography.metaSize,
      marginBottom: spacing.sm
    },
    diffLine: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.xs,
      paddingVertical: 2,
      paddingHorizontal: spacing.xs
    },
    diffLineAdd: {
      backgroundColor: colors.diffAddBg
    },
    diffLineDelete: {
      backgroundColor: colors.diffDelBg
    },
    diffLineNumber: {
      width: 40,
      color: colors.textMuted,
      fontFamily: typography.monoFamily,
      fontSize: typography.metaSize,
      textAlign: 'right'
    },
    diffLinePrefix: {
      width: 12,
      color: colors.textSecondary,
      fontFamily: typography.monoFamily,
      fontSize: typography.metaSize
    },
    diffLineText: {
      flex: 1,
      color: colors.text,
      fontFamily: typography.monoFamily,
      fontSize: typography.metaSize,
      lineHeight: 17
    }
  })
}
