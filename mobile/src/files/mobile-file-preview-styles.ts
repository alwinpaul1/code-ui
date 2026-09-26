import { StyleSheet } from 'react-native'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'

export const filePreviewStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgBase
  },
  // The header (bar, Back, title, meta and its action buttons) moved to the
  // themed mobile-file-preview-header-styles.ts on 2026-09-26, when it gained
  // Save to phone.
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
    color: colors.statusRed,
    fontSize: typography.bodySize,
    textAlign: 'center'
  },
  retryButton: {
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.button,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.lg
  },
  retryText: {
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontWeight: '600'
  },
  scroll: {
    flex: 1,
    backgroundColor: colors.editorSurface
  },
  textContent: {
    padding: spacing.md,
    paddingBottom: spacing.xl
  },
  textPreview: {
    color: colors.textPrimary,
    fontFamily: typography.monoFamily,
    fontSize: 13,
    lineHeight: 19
  },
  // The markdown preview's own chrome — container, toolbar, the two mode
  // toggles, the content padding — used to live here, on the static dark
  // palette. It moved into MobileFileMarkdownPreview.tsx as a themed factory so
  // the preview follows light mode; these copies were left behind with no
  // reader. Anything that needs them again should take the themed ones.
  truncatedNote: {
    marginBottom: spacing.md,
    color: colors.textSecondary,
    fontSize: typography.metaSize
  },
  imageContainer: {
    flex: 1,
    backgroundColor: colors.editorSurface
  },
  imageScrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md
  },
  editContainer: {
    flex: 1,
    backgroundColor: colors.editorSurface,
    padding: spacing.md
  },
  saveErrorText: {
    marginBottom: spacing.sm,
    color: colors.statusRed,
    fontSize: typography.metaSize
  },
  editInput: {
    flex: 1,
    color: colors.textPrimary,
    fontFamily: typography.monoFamily,
    fontSize: 13,
    lineHeight: 19,
    padding: 0
  }
})
