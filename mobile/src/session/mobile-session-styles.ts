import type { Theme } from '../theme/theme-context'
import { mobileSessionCommandInputStyles } from './mobile-session-command-input-styles'
import { mobileSessionFrameStyles } from './mobile-session-frame-styles'
import { mobileSessionReaderStyles } from './mobile-session-reader-styles'
import { mobileSessionReviewCommentStyles } from './mobile-session-review-comment-styles'

/**
 * Merges the four session style factories against a live theme. Every session component reads
 * this through `useThemedStyles(sessionStyles)`. There is no static copy: a dark-pinned `styles`
 * export lived here until 2026-09-27 and drew the session canvas dark in a light session.
 */
export function sessionStyles(theme: Theme) {
  return {
    ...mobileSessionFrameStyles(theme),
    ...mobileSessionReaderStyles(theme),
    ...mobileSessionReviewCommentStyles(theme),
    ...mobileSessionCommandInputStyles(theme)
  }
}
