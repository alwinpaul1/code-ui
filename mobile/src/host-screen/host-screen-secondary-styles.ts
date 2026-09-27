import { StyleSheet } from 'react-native'
import { spacing, typography } from '../theme/mobile-theme'
import type { Theme } from '../theme/theme-context'

export function hostScreenSecondaryStyles({ colors }: Theme) {
  return StyleSheet.create({
    errorText: {
      color: colors.danger,
      fontSize: typography.bodySize
    },
    list: {
      paddingBottom: spacing.lg
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.xs
    },
    sectionIcon: {
      marginRight: spacing.xs
    },
    sectionRepoIcon: {
      marginRight: spacing.xs
    },
    sectionTitle: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5
    },
    sectionCount: {
      fontSize: 11,
      color: colors.textMuted,
      marginLeft: spacing.xs
    },
    separator: {
      height: 1,
      backgroundColor: colors.border,
      marginLeft: spacing.lg + 24,
      marginRight: spacing.lg
    },
    filterModalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.xs,
      marginBottom: spacing.md
    },
    filterModalTitle: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text
    },
    clearFiltersText: {
      fontSize: 13,
      color: colors.textSecondary
    },
    filterSectionLabel: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: spacing.xs,
      paddingHorizontal: spacing.xs
    },
    filterGroup: {
      backgroundColor: colors.bgPanel,
      borderRadius: 12,
      overflow: 'hidden',
      marginBottom: spacing.md
    },
    filterRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md + 2,
      gap: spacing.sm
    },
    filterRowText: {
      flex: 1,
      fontSize: typography.bodySize,
      color: colors.text
    },
    filterSeparator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginHorizontal: spacing.md
    },
    filterRepoDot: {
      width: 8,
      height: 8,
      borderRadius: 4
    },
    confirmContent: {
      paddingBottom: spacing.lg
    },
    confirmTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text
    },
    confirmMessage: {
      fontSize: typography.bodySize,
      color: colors.textSecondary,
      marginTop: spacing.xs,
      lineHeight: 20
    },
    confirmButtons: {
      flexDirection: 'row',
      gap: spacing.sm
    },
    confirmBtn: {
      flex: 1,
      paddingVertical: spacing.sm + 2,
      borderRadius: 10,
      alignItems: 'center'
    },
    confirmBtnCancel: {
      backgroundColor: colors.bgPanel
    },
    confirmBtnDestructive: {
      backgroundColor: colors.danger
    },
    confirmBtnPressed: {
      opacity: 0.7
    },
    confirmBtnCancelText: {
      fontSize: typography.bodySize,
      fontWeight: '600',
      color: colors.textSecondary
    },
    confirmBtnDestructiveText: {
      // The platform draws its own destructive buttons in white on red; kept as a named constant
      // (not a token) for the same reason the legacy `onStatusRed` was: it is a fixed pairing with
      // `danger`, not a role that should follow the theme's ink/paper balance.
      fontSize: typography.bodySize,
      fontWeight: '600',
      color: ON_DESTRUCTIVE_FILL
    }
  })
}

/** White label on the destructive-red fill, in both schemes, mirroring the platform's own
 *  destructive buttons (see mobile-theme.ts's `onStatusRed` for the contrast rationale this
 *  carries forward: 3.3:1 on the red, clearing the 3:1 floor for a bold label). */
const ON_DESTRUCTIVE_FILL = '#ffffff'
