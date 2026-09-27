import { StyleSheet } from 'react-native'
import { radii, spacing, typography } from '../../theme/mobile-theme'
import type { Theme } from '../../theme/theme-context'
import { TEXT_INPUT_FONT_SIZE } from '../../platform/text-input-font-size'

// Styles for the plain-text reply / root-comment composer. Muted/monochrome to
// match the PR comment timeline; split out to keep PRCommentComposer focused.
// Built from the live theme so it reads in both schemes.
export function prCommentComposerStyles({ colors }: Theme) {
  return StyleSheet.create({
    container: {
      // Input → Cancel/Save needs clear separation (title edit was flush without this).
      gap: spacing.md
    },
    input: {
      minHeight: 64,
      backgroundColor: colors.bgRaised,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: radii.input,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      color: colors.text,
      fontSize: TEXT_INPUT_FONT_SIZE,
      textAlignVertical: 'top'
    },
    actions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: spacing.sm
    },
    cancel: {
      minHeight: 36,
      paddingHorizontal: spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.button
    },
    cancelText: {
      color: colors.textSecondary,
      fontSize: typography.metaSize,
      fontWeight: '600'
    },
    // The "inverse surface" pair used for the app's one bright action: near-black
    // fill on cream text in light, near-white fill on ink text in dark.
    submit: {
      minHeight: 36,
      minWidth: 72,
      paddingHorizontal: spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.button,
      backgroundColor: colors.text
    },
    submitDisabled: {
      opacity: 0.45
    },
    submitText: {
      color: colors.bg,
      fontSize: typography.metaSize,
      fontWeight: '700'
    },
    pressed: {
      opacity: 0.8
    },
    error: {
      color: colors.danger,
      fontSize: typography.metaSize
    }
  })
}
