import { StyleSheet } from 'react-native'
import { radii, spacing, typography } from '../theme/mobile-theme'
import type { Theme } from '../theme/theme-context'
import { TEXT_INPUT_FONT_SIZE } from '../platform/text-input-font-size'

/** The diff review footer/composer/drawer controls, built from the live theme so they read in
 *  light and in dark. Only the colours come from the theme; the sizes are the legacy scale's
 *  numbers, which are the same in both schemes. Callers take it through
 *  `useThemedStyles(mobileDiffReviewControlStyles)`. */
export function mobileDiffReviewControlStyles({ colors }: Theme) {
  return StyleSheet.create({
    footer: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      gap: spacing.sm,
      backgroundColor: colors.bg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border
    },
    fileActionRow: {
      flexDirection: 'row',
      gap: spacing.sm
    },
    footerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm
    },
    navButton: {
      width: 44,
      minHeight: 44,
      borderRadius: radii.button,
      backgroundColor: colors.bgRaised,
      alignItems: 'center',
      justifyContent: 'center'
    },
    footerButton: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      borderRadius: radii.button,
      backgroundColor: colors.bgRaised
    },
    footerButtonText: {
      color: colors.textSecondary,
      fontSize: typography.bodySize,
      fontWeight: '700'
    },
    primaryButton: {
      flex: 1,
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      borderRadius: radii.button,
      backgroundColor: colors.text
    },
    primaryButtonDone: {
      backgroundColor: colors.success
    },
    primaryButtonText: {
      color: colors.bg,
      fontSize: typography.bodySize,
      fontWeight: '800'
    },
    secondaryButton: {
      flex: 1,
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      borderRadius: radii.button,
      backgroundColor: colors.bgRaised
    },
    secondaryButtonText: {
      color: colors.textSecondary,
      fontSize: typography.bodySize,
      fontWeight: '700'
    },
    destructiveText: {
      color: colors.danger,
      fontSize: typography.bodySize,
      fontWeight: '700'
    },
    buttonPressed: {
      opacity: 0.76
    },
    buttonDisabled: {
      opacity: 0.45
    },
    composerHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: spacing.md,
      marginBottom: spacing.md
    },
    drawerTitle: {
      color: colors.text,
      fontSize: typography.titleSize,
      fontWeight: '700'
    },
    drawerSubtitle: {
      color: colors.textMuted,
      fontSize: typography.metaSize,
      marginTop: 2
    },
    composerInput: {
      minHeight: 112,
      borderRadius: radii.input,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.bgPanel,
      color: colors.text,
      // Through the seam, as the commit bar is: 14px focuses into a zoomed page on iOS.
      fontSize: TEXT_INPUT_FONT_SIZE,
      lineHeight: 20,
      padding: spacing.md,
      textAlignVertical: 'top'
    },
    drawerButtonRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.md
    }
  })
}
