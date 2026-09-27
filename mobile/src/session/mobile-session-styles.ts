import { fontFamily, radius, space, type, colorsForScheme } from '../theme/tokens'
import { syntaxPaletteForScheme } from '../theme/syntax-palette'
import type { Theme } from '../theme/theme-context'
import { mobileSessionCommandInputStyles } from './mobile-session-command-input-styles'
import { mobileSessionFrameStyles } from './mobile-session-frame-styles'
import { mobileSessionReaderStyles } from './mobile-session-reader-styles'
import { mobileSessionReviewCommentStyles } from './mobile-session-review-comment-styles'

/**
 * Merges the four session style factories against a live theme. Converted call sites read this
 * through `useThemedStyles(sessionStyles)`; see `MobileSessionMarkdownReader.tsx` for the pattern.
 */
export function sessionStyles(theme: Theme) {
  return {
    ...mobileSessionFrameStyles(theme),
    ...mobileSessionReaderStyles(theme),
    ...mobileSessionReviewCommentStyles(theme),
    ...mobileSessionCommandInputStyles(theme)
  }
}

// A full `Theme`, pinned to dark, built from the same public tokens `ThemeProvider` uses (not a
// copy of its private `buildTheme`) — see the const below.
const legacyDarkTheme: Theme = {
  scheme: 'dark',
  preference: 'dark',
  setPreference: () => undefined,
  colors: colorsForScheme('dark'),
  syntax: syntaxPaletteForScheme('dark'),
  space,
  radius,
  type,
  fonts: fontFamily,
  isDark: true
}

/**
 * LEGACY: pinned to the dark palette (mobile-theme.ts's old hardcoded values, republished through
 * the new tokens) for screens that have not yet moved to `sessionStyles` + `useThemedStyles` — see
 * mobile/CLAUDE.md's theme sweep. They keep rendering dark, unchanged, until their own pass.
 */
export const styles = sessionStyles(legacyDarkTheme)
