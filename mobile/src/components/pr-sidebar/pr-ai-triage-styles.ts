import { StyleSheet } from 'react-native'
import { radii, spacing, typography } from '../../theme/mobile-theme'
import type { Theme } from '../../theme/theme-context'

// Styles for the "Fix checks with AI" / "Resolve conflicts with AI" triage
// affordances. Kept in their own focused file (rather than growing the shared
// sidebar/conflict style sheets) and muted/monochrome to match the sidebar.
// Built from the live theme so it reads in both schemes.
export function prAiTriageStyles({ colors }: Theme) {
  return StyleSheet.create({
    triageArea: {
      gap: spacing.xs
    },
    // Top-of-section triage strip (desktop PRTriageStrip): failing-count summary +
    // a Fix action on the right, tinted by the failure status color.
    triageStrip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      padding: spacing.sm,
      borderRadius: radii.button,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.danger,
      backgroundColor: colors.diffDelBg
    },
    triageStripText: {
      flex: 1,
      minWidth: 0
    },
    triageStripTitle: {
      color: colors.text,
      fontSize: typography.metaSize,
      fontWeight: '700'
    },
    triageStripSubtitle: {
      color: colors.textSecondary,
      fontSize: typography.metaSize
    },
    // Compact Fix button sitting inside the strip (vs. the full-width footer button).
    triageStripButton: {
      minHeight: 32,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.sm,
      borderRadius: radii.button,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.bgRaised
    },
    triageStripButtonText: {
      color: colors.textSecondary,
      fontSize: typography.metaSize,
      fontWeight: '700'
    },
    triageButton: {
      minHeight: 36,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      borderRadius: radii.button,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.bgRaised
    },
    triageButtonPressed: {
      opacity: 0.7
    },
    triageButtonText: {
      color: colors.textSecondary,
      fontSize: typography.bodySize,
      fontWeight: '600'
    },
    triageError: {
      color: colors.danger,
      fontSize: typography.metaSize
    }
  })
}
