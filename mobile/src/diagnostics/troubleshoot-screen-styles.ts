import { StyleSheet } from 'react-native'
import { spacing, typography } from '../theme/mobile-theme'
import { useThemedStyles, type Theme } from '../theme/theme-context'

/**
 * The Troubleshoot screen's styles, from the live theme. They were one static sheet on the legacy
 * dark palette, so the screen stayed dark in light mode, and so did every row it hosts (2026-09-25).
 * Layout still reads the legacy spacing and type scale: only the colours moved.
 */
export function useTroubleshootScreenStyles(): TroubleshootScreenStyles {
  return useThemedStyles(troubleshootScreenStyles)
}

export type TroubleshootScreenStyles = ReturnType<typeof troubleshootScreenStyles>

function troubleshootScreenStyles({ colors }: Theme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg,
      padding: spacing.lg
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
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
    scroll: {
      flex: 1
    },
    scrollContent: {
      paddingBottom: spacing.xl
    },
    diagnosticButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      backgroundColor: colors.bgRaised,
      borderRadius: 10,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.lg
    },
    diagnosticButtonPressed: {
      opacity: 0.7
    },
    diagnosticButtonDisabled: {
      opacity: 0.5
    },
    diagnosticButtonLabel: {
      fontSize: typography.bodySize,
      fontWeight: '600',
      color: colors.text
    },
    checkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.md + 2
    },
    checkLabel: {
      fontSize: typography.bodySize,
      fontWeight: '500',
      color: colors.text
    },
    checkDetail: {
      flex: 1,
      textAlign: 'right',
      fontSize: typography.metaSize,
      color: colors.textMuted
    },
    checkDetailFail: {
      color: colors.danger
    },
    sectionHeading: {
      fontSize: typography.metaSize,
      fontWeight: '600',
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: spacing.sm,
      marginTop: spacing.sm,
      paddingHorizontal: spacing.xs
    },
    section: {
      backgroundColor: colors.bgPanel,
      borderRadius: 12,
      overflow: 'hidden',
      marginBottom: spacing.lg
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginHorizontal: spacing.md
    },
    rowPressed: {
      backgroundColor: colors.bgRaised
    },
    accordionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm + 2,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md + 2
    },
    accordionTitle: {
      flex: 1,
      fontSize: typography.bodySize,
      fontWeight: '500',
      color: colors.text
    },
    accordionBody: {
      paddingHorizontal: spacing.md + 2,
      paddingBottom: spacing.md,
      gap: spacing.xs + 2
    },
    stepRow: {
      flexDirection: 'row',
      gap: spacing.sm
    },
    bullet: {
      fontSize: typography.metaSize,
      color: colors.textMuted,
      lineHeight: 18
    },
    stepText: {
      flex: 1,
      fontSize: typography.metaSize,
      color: colors.textMuted,
      lineHeight: 18
    }
  })
}
