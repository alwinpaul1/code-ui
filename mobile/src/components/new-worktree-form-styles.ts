import { Platform, StyleSheet } from 'react-native'
import { radii, spacing, typography } from '../theme/mobile-theme'
import type { Theme } from '../theme/theme-context'
import { TEXT_INPUT_FONT_SIZE } from '../platform/text-input-font-size'

/** The new-worktree form sheet's styles, built from the live theme so it reads in light and in
 *  dark. Only the colours come from the theme; the sizes are the legacy scale's numbers, which
 *  are the same in both schemes. Callers take it through `useThemedStyles(newWorktreeFormStyles)`. */
export function newWorktreeFormStyles({ colors }: Theme) {
  return StyleSheet.create({
    header: {
      paddingHorizontal: spacing.xs,
      marginBottom: spacing.md
    },
    title: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text
    },
    loadingContainer: {
      paddingVertical: spacing.xl,
      alignItems: 'center'
    },
    emptyText: {
      color: colors.textSecondary,
      fontSize: typography.bodySize
    },
    field: {
      marginBottom: spacing.md
    },
    label: {
      fontSize: 13,
      fontWeight: '500',
      color: colors.textSecondary,
      marginBottom: spacing.xs
    },
    labelHint: {
      fontWeight: '400',
      color: colors.textMuted
    },
    fieldButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.bgRaised,
      borderRadius: radii.input,
      paddingHorizontal: spacing.md,
      paddingVertical: Platform.OS === 'ios' ? spacing.sm + 2 : spacing.sm,
      borderWidth: 1,
      borderColor: colors.border
    },
    fieldButtonText: {
      fontSize: typography.bodySize,
      color: colors.text
    },
    fieldButtonPlaceholder: {
      color: colors.textMuted
    },
    repoDot: {
      width: 8,
      height: 8,
      borderRadius: 999
    },
    disabled: {
      opacity: 0.55
    },
    sshBox: {
      backgroundColor: colors.bgRaised,
      borderRadius: radii.input,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      gap: spacing.xs
    },
    sshRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm
    },
    sshDot: {
      width: 8,
      height: 8,
      borderRadius: 999
    },
    sshDotConnected: {
      backgroundColor: colors.success
    },
    sshDotProgress: {
      backgroundColor: colors.warning
    },
    sshDotDisconnected: {
      backgroundColor: colors.danger
    },
    sshCopy: {
      flex: 1,
      minWidth: 0
    },
    sshTitle: {
      fontSize: typography.bodySize,
      color: colors.text,
      fontWeight: '600'
    },
    sshSubtitle: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 1
    },
    sshConnectButton: {
      borderRadius: radii.button,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs
    },
    sshConnectText: {
      color: colors.text,
      fontSize: 12,
      fontWeight: '600'
    },
    errorInline: {
      color: colors.danger,
      fontSize: 12
    },
    input: {
      backgroundColor: colors.bgRaised,
      color: colors.text,
      borderRadius: radii.input,
      paddingHorizontal: spacing.md,
      paddingVertical: Platform.OS === 'ios' ? spacing.sm + 2 : spacing.sm,
      fontSize: TEXT_INPUT_FONT_SIZE,
      borderWidth: 1,
      borderColor: colors.border
    },
    error: {
      color: colors.danger,
      fontSize: 13,
      marginBottom: spacing.md
    },
    sourceWarning: {
      marginTop: -spacing.sm,
      marginBottom: spacing.md,
      fontSize: 12,
      color: colors.warning
    },
    advancedToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingVertical: spacing.sm,
      marginBottom: spacing.xs
    },
    advancedText: {
      fontSize: typography.bodySize,
      fontWeight: '500',
      color: colors.textSecondary
    },
    setupHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.xs
    },
    sourceBadge: {
      backgroundColor: colors.bgRaised,
      borderRadius: 4,
      paddingHorizontal: spacing.xs + 2,
      paddingVertical: 2
    },
    sourceBadgeText: {
      fontSize: 10,
      fontWeight: '600',
      color: colors.textMuted,
      letterSpacing: 0.5
    },
    setupBox: {
      backgroundColor: colors.bgRaised,
      borderRadius: radii.input,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md
    },
    setupToggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.sm
    },
    setupToggleLabel: {
      fontSize: 13,
      color: colors.textSecondary
    },
    setupChoiceRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginBottom: spacing.sm
    },
    setupChoiceButton: {
      flex: 1,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.button,
      paddingVertical: spacing.sm
    },
    setupChoiceButtonSelected: {
      backgroundColor: colors.bgPanel,
      borderColor: colors.textSecondary
    },
    setupChoiceText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text
    },
    setupSwitch: {
      transform: [{ scaleX: 0.7 }, { scaleY: 0.7 }]
    },
    setupCommandBlock: {
      backgroundColor: colors.bg,
      borderRadius: 6,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: spacing.sm
    },
    setupCommand: {
      fontSize: 13,
      fontFamily: typography.monoFamily,
      color: colors.text
    },
    actions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      marginTop: spacing.sm
    },
    createButton: {
      backgroundColor: colors.text,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radii.button,
      minWidth: 160,
      alignItems: 'center'
    },
    createButtonDisabled: {
      opacity: 0.4
    },
    createText: {
      color: colors.bg,
      fontSize: typography.bodySize,
      fontWeight: '600'
    }
  })
}
