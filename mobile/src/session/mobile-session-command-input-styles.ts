import { StyleSheet } from 'react-native'

import { spacing, radii, typography } from '../theme/mobile-theme'
import { TEXT_INPUT_FONT_SIZE } from '../platform/text-input-font-size'
import type { Theme } from '../theme/theme-context'

export function mobileSessionCommandInputStyles({ colors }: Theme) {
  return StyleSheet.create({
    createWarningBanner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      backgroundColor: colors.bgPanel,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm
    },
    createWarningText: {
      flex: 1,
      color: colors.text,
      fontSize: 12,
      lineHeight: 16
    },
    createWarningDismiss: {
      width: 24,
      height: 24,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: -4
    },
    emptyState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xl
    },
    emptyText: {
      color: colors.textSecondary,
      fontSize: typography.bodySize,
      marginBottom: spacing.lg
    },
    createError: {
      color: colors.danger,
      fontSize: 13,
      marginBottom: spacing.sm
    },
    emptyActions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: spacing.sm
    },
    createButton: {
      backgroundColor: colors.bgRaised,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.sm + 2,
      borderRadius: radii.button
    },
    createButtonDisabled: {
      opacity: 0.5
    },
    createButtonText: {
      color: colors.text,
      fontSize: typography.bodySize,
      fontWeight: '600'
    },
    commandDock: {
      zIndex: 20
    },
    accessoryBar: {
      flexDirection: 'row',
      alignItems: 'center',
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.bgPanel
    },
    accessoryScroll: {
      flex: 1,
      minWidth: 0
    },
    accessoryContent: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      gap: spacing.xs
    },
    accessoryKey: {
      backgroundColor: colors.bgRaised,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: spacing.xs,
      borderRadius: radii.button,
      minWidth: 36,
      alignItems: 'center'
    },
    accessoryKeyPressed: {
      backgroundColor: colors.border
    },
    accessoryKeyActive: {
      backgroundColor: colors.text
    },
    customAccessoryKey: {
      borderWidth: 1,
      borderColor: colors.border
    },
    accessoryKeyDisabled: {
      opacity: 0.35
    },
    accessoryKeyText: {
      color: colors.textSecondary,
      fontSize: 12,
      fontFamily: typography.monoFamily
    },
    accessoryKeyTextActive: {
      // On the inverse fill above (`text` used as a bright surface), the label takes the inverse
      // text colour rather than the page's own.
      color: colors.textInverse,
      fontWeight: '700'
    },
    accessoryKeyTextDisabled: {
      color: colors.textMuted
    },
    keyboardDismissKey: {
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: spacing.sm,
      marginVertical: spacing.xs,
      backgroundColor: colors.bgRaised,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: 0,
      borderRadius: radii.button,
      minWidth: 36,
      height: 28
    },
    keyboardDismissGlyph: {
      alignItems: 'center',
      height: 18,
      justifyContent: 'flex-start',
      position: 'relative',
      width: 18
    },
    keyboardDismissChevron: {
      bottom: -2,
      position: 'absolute'
    },
    inputBar: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 46,
      paddingVertical: spacing.xs + 2,
      paddingHorizontal: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.bgPanel
    },
    textInput: {
      flex: 1,
      height: 34,
      backgroundColor: colors.bgRaised,
      color: colors.text,
      borderRadius: radii.input,
      paddingHorizontal: spacing.md,
      paddingVertical: 0,
      fontSize: TEXT_INPUT_FONT_SIZE,
      fontFamily: typography.monoFamily,
      marginRight: spacing.sm
    },
    liveInputBar: {
      gap: spacing.sm
    },

    liveInputFocusTarget: {
      flex: 1,
      minHeight: 34,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.bgRaised,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      paddingHorizontal: spacing.sm + 2
    },

    liveInputFocusTargetPressed: {
      backgroundColor: colors.border
    },

    liveInputFocusTargetDisabled: {
      opacity: 0.45
    },

    liveInputCapture: {
      position: 'absolute',
      opacity: 0,
      width: 1,
      height: 1,
      color: colors.text
    },
    sendButton: {
      backgroundColor: colors.bgRaised,
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center'
    },
    dictationButton: {
      backgroundColor: colors.bgRaised,
      width: 34,
      height: 34,
      borderRadius: 17,
      borderWidth: 1,
      borderColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: spacing.sm
    },
    dictationButtonActive: {
      backgroundColor: colors.bgPanel,
      borderColor: colors.textSecondary
    },
    sendButtonDisabled: {
      opacity: 0.35
    }
  })
}
