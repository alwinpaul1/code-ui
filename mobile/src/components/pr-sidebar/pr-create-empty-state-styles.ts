import { StyleSheet } from 'react-native'
import { radii, spacing, typography } from '../../theme/mobile-theme'
import type { Theme } from '../../theme/theme-context'

// Built from the live theme so the create/link empty state reads in both schemes.
export function prCreateEmptyStateStyles({ colors }: Theme) {
  return StyleSheet.create({
    section: {
      backgroundColor: colors.bgPanel,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      overflow: 'hidden'
    },
    header: {
      minHeight: 40,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border
    },
    headerTitle: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs
    },
    headerLabel: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '600'
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs
    },
    // The "inverse surface" pair used for the app's one bright action: near-black
    // fill on cream text in light, near-white fill on ink text in dark.
    createButton: {
      minHeight: 32,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.sm,
      borderRadius: radii.button,
      backgroundColor: colors.text
    },
    createButtonDisabled: {
      opacity: 0.5
    },
    createButtonText: {
      color: colors.bg,
      fontSize: typography.metaSize,
      fontWeight: '700'
    },
    iconButton: {
      minWidth: 32,
      minHeight: 32,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.button
    },
    iconButtonPressed: {
      backgroundColor: colors.bgRaised
    },
    body: {
      padding: spacing.md,
      gap: spacing.sm
    },
    bodyTitle: {
      color: colors.text,
      fontSize: typography.bodySize,
      fontWeight: '700'
    },
    bodyText: {
      color: colors.textSecondary,
      fontSize: typography.metaSize,
      lineHeight: 18
    },
    composerArea: {
      backgroundColor: colors.bgPanel,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      padding: spacing.md
    },
    // Secondary link-an-existing-PR affordance, set apart from the body copy.
    linkButton: {
      marginTop: spacing.xs,
      minHeight: 32,
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs
    },
    linkButtonDisabled: {
      opacity: 0.5
    },
    linkButtonPressed: {
      opacity: 0.6
    },
    linkButtonText: {
      color: colors.textSecondary,
      fontSize: typography.metaSize,
      fontWeight: '600'
    }
  })
}
