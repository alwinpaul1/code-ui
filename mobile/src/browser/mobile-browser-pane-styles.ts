import { StyleSheet } from 'react-native'
import { TEXT_INPUT_FONT_SIZE } from '../platform/text-input-font-size'
import { radii, spacing, typography } from '../theme/mobile-theme'
import type { Theme } from '../theme/theme-context'

/** The busy/error scrim over the web page's own pixels. Fixed in both schemes: it tints content the
 *  app does not draw, the way the terminal's content keeps its own colours. */
export const BROWSER_CONTENT_SCRIM = 'rgba(13, 15, 24, 0.2)'
/** The spinner over a rendered page, fixed light for the same reason as the scrim it sits in. */
export const BROWSER_CONTENT_SPINNER = '#B8B4AB'

/** The two flip-layer wrappers carry no colour, so they stay a plain (unthemed) StyleSheet that
 *  `use-mobile-browser-pane-layers.ts` can keep reading as a static import. */
export const mobileBrowserPaneLayerStyles = StyleSheet.create({
  browserImageLayer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center'
  },
  browserImageLayerHidden: {
    opacity: 0
  }
})

export function mobileBrowserPaneStyles({ colors }: Theme) {
  return StyleSheet.create({
    root: {
      flex: 1,
      minHeight: 0,
      backgroundColor: colors.bg
    },
    toolbar: {
      minHeight: 32,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.bgPanel
    },
    viewport: {
      flex: 1,
      minHeight: 0,
      overflow: 'hidden',
      backgroundColor: colors.bg
    },
    browserImageHost: {
      ...StyleSheet.absoluteFill,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden'
    },
    browserImageFill: {
      width: '100%',
      height: '100%'
    },
    browserZoomOffset: {
      alignItems: 'center',
      justifyContent: 'center'
    },
    browserFrameBox: {
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden'
    },
    browserImage: {
      backgroundColor: colors.bg
    },
    overlay: {
      ...StyleSheet.absoluteFill,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xl,
      gap: spacing.sm,
      backgroundColor: BROWSER_CONTENT_SCRIM
    },
    errorText: {
      color: colors.text,
      backgroundColor: colors.bgPanel,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.button,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontSize: 13,
      textAlign: 'center',
      overflow: 'hidden'
    },
    dialogOverlay: {
      ...StyleSheet.absoluteFill,
      zIndex: 30,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xl,
      backgroundColor: colors.bgOverlay
    },
    dialogCard: {
      width: '100%',
      maxWidth: 360,
      borderRadius: radii.card,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bgPanel,
      padding: spacing.lg
    },
    dialogTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600'
    },
    dialogMessage: {
      color: colors.textSecondary,
      fontSize: typography.bodySize,
      lineHeight: 20,
      marginTop: spacing.sm
    },
    dialogButtonDisabled: {
      opacity: 0.5
    },
    dialogError: {
      color: colors.danger,
      fontSize: typography.metaSize,
      lineHeight: 18,
      marginTop: spacing.sm
    },
    dialogActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: spacing.sm,
      marginTop: spacing.lg
    },
    dialogButton: {
      minHeight: 34,
      borderRadius: radii.button,
      backgroundColor: colors.bgRaised,
      paddingHorizontal: spacing.md,
      alignItems: 'center',
      justifyContent: 'center'
    },
    dialogButtonPrimary: {
      backgroundColor: colors.text
    },
    dialogButtonPressed: {
      opacity: 0.75
    },
    dialogButtonText: {
      color: colors.textSecondary,
      fontSize: typography.bodySize,
      fontWeight: '600'
    },
    dialogButtonPrimaryText: {
      // On an inverse fill (`colors.text`: near-white in dark, near-black in light), so the label
      // takes the inverse text colour, not the page's own.
      color: colors.textInverse
    },
    keyboardDock: {
      zIndex: 20,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.bgPanel
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingTop: spacing.xs,
      paddingBottom: spacing.xs + 2
    },
    keyboardInput: {
      flex: 1,
      height: 34,
      backgroundColor: colors.bgRaised,
      color: colors.text,
      borderRadius: radii.input,
      paddingHorizontal: spacing.md,
      // The seam, not the 14 it was: on the web an input under 16px zooms the page on focus and the
      // keyboard seam reads that zoom as "no keyboard". Natively the seam is the theme's body size,
      // which is what this already rendered at.
      fontSize: TEXT_INPUT_FONT_SIZE,
      fontFamily: typography.monoFamily,
      marginRight: spacing.sm
    },
    sendButton: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.bgRaised
    },
    disabled: {
      opacity: 0.35
    },
    disabledText: {
      color: colors.textMuted
    }
  })
}
