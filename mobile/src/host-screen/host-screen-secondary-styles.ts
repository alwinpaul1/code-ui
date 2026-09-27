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
      // The platform draws its own destructive buttons in white on red; a named constant, not a
      // token: it is a fixed pairing with `danger`, not a role that should follow the theme's
      // ink/paper balance.
      fontSize: typography.bodySize,
      fontWeight: '600',
      color: ON_DESTRUCTIVE_FILL
    }
  })
}

/** White label on the destructive-red fill, in both schemes, mirroring the platform's own
 *  destructive buttons. 5.44:1 on light `danger`; 3.25:1 on dark `danger`, which clears the 3:1
 *  floor for a bold label and not the 4.5:1 body target (iOS ships 3.0:1 for the same control).
 *  Ink would reach 5.4:1 on the dark red too, but it changes what a destructive button looks
 *  like, which is a product call, not a token's. Pinned by legacy-hex-hardcodes.test.ts. */
export const ON_DESTRUCTIVE_FILL = '#ffffff'
