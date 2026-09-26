import { StyleSheet } from 'react-native'
import { radii, spacing, typography } from '../theme/mobile-theme'
import type { Theme } from '../theme/theme-context'

/**
 * The file preview's page and body, from the live theme: the screen's canvas, the loading and error
 * states, the source text, the image surface and the artifact editor. They sat on the static dark
 * palette, so once the header was themed (mobile-file-preview-header-styles.ts, 2026-09-26) light
 * mode showed a light header over a dark page. Sizes are the ones they always had; only the colours
 * moved. The editor surface was a shade of its own (#1E1C19) that no theme token has; it is the
 * page colour now in both schemes, four steps darker in dark.
 */
export function filePreviewStyles({ colors }: Theme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg
    },
    state: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.md,
      padding: spacing.xl
    },
    stateText: {
      color: colors.textSecondary,
      fontSize: typography.bodySize,
      textAlign: 'center'
    },
    errorText: {
      color: colors.danger,
      fontSize: typography.bodySize,
      textAlign: 'center'
    },
    retryButton: {
      minHeight: 36,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.button,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingHorizontal: spacing.lg
    },
    retryText: {
      color: colors.text,
      fontSize: typography.bodySize,
      fontWeight: '600'
    },
    scroll: {
      flex: 1,
      backgroundColor: colors.bg
    },
    textContent: {
      padding: spacing.md,
      paddingBottom: spacing.xl
    },
    textPreview: {
      color: colors.text,
      fontFamily: typography.monoFamily,
      fontSize: 13,
      lineHeight: 19
    },
    truncatedNote: {
      marginBottom: spacing.md,
      color: colors.textSecondary,
      fontSize: typography.metaSize
    },
    imageContainer: {
      flex: 1,
      backgroundColor: colors.bg
    },
    imageScrollContent: {
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.md
    },
    editContainer: {
      flex: 1,
      backgroundColor: colors.bg,
      padding: spacing.md
    },
    saveErrorText: {
      marginBottom: spacing.sm,
      color: colors.danger,
      fontSize: typography.metaSize
    },
    editInput: {
      flex: 1,
      color: colors.text,
      fontFamily: typography.monoFamily,
      fontSize: 13,
      lineHeight: 19,
      padding: 0
    }
  })
}
