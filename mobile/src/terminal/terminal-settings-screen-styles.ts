import { StyleSheet } from 'react-native'
import { radii, spacing, typography } from '../theme/mobile-theme'
import type { Theme } from '../theme/theme-context'

/** Built from the live theme so the Terminal settings screen reads in light and in dark
 *  (`useThemedStyles(terminalSettingsScreenStyles)`). Only the colours changed; the legacy scale's
 *  sizes are unchanged. */
export function terminalSettingsScreenStyles({ colors }: Theme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg,
      paddingHorizontal: spacing.lg,
      paddingTop: 0
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: spacing.sm,
      marginBottom: spacing.lg
    },
    backButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: spacing.sm
    },
    heading: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.text
    },
    scrollContent: {
      paddingBottom: spacing.xl
    },
    groupHeading: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textMuted,
      letterSpacing: 0.5,
      marginBottom: spacing.xs,
      paddingHorizontal: spacing.xs
    },
    section: {
      backgroundColor: colors.bgPanel,
      borderRadius: radii.card,
      overflow: 'hidden'
    },
    sectionTopGap: {
      marginTop: spacing.sm
    },
    inputGroupGap: {
      marginTop: spacing.xl
    },
    emptyText: {
      fontSize: typography.bodySize,
      color: colors.textSecondary,
      padding: spacing.md
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm + 2,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md + 2
    },
    rowPressed: {
      backgroundColor: colors.bgRaised
    },
    rowContent: {
      flex: 1
    },
    rowLabel: {
      fontSize: typography.bodySize,
      fontWeight: '500',
      color: colors.text
    },
    rowSublabel: {
      fontSize: typography.bodySize - 2,
      color: colors.textSecondary,
      marginTop: 2
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginHorizontal: spacing.md
    }
  })
}
