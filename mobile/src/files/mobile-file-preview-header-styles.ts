import { StyleSheet } from 'react-native'
import type { Theme } from '../theme/theme-context'

/**
 * The file preview's header, from the live theme. It sat on the static dark palette with the rest
 * of the screen, so in light mode the preview opened under a dark bar; it moved here when the bar
 * gained "Save to phone" (2026-09-26), same geometry as before. The body's own views keep their
 * styles in mobile-file-preview-styles.ts.
 */
export function filePreviewHeaderStyles({ colors, radius, space, type }: Theme) {
  return StyleSheet.create({
    header: {
      backgroundColor: colors.bgPanel,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border
    },
    topBar: {
      minHeight: 58,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      paddingHorizontal: space.md
    },
    backButton: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.xs
    },
    backButtonPressed: {
      backgroundColor: colors.bgRaised
    },
    titleBlock: {
      flex: 1,
      minWidth: 0
    },
    title: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '600'
    },
    meta: {
      marginTop: 2,
      color: colors.textSecondary,
      fontSize: type.caption.size
    },
    actionButton: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.xs,
      backgroundColor: colors.bgRaised
    },
    actionButtonDisabled: {
      opacity: 0.42
    }
  })
}
