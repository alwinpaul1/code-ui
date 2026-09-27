import type { Theme } from '../theme/theme-context'
import { mobileDiffReviewControlStyles } from './mobile-diff-review-control-styles'
import { mobileDiffReviewLayoutStyles } from './mobile-diff-review-layout-styles'

/** Merges the diff review screen's layout and control styles into one themed factory. Not in the
 *  theme-review slice itself, but forced: both halves it merges are, and every diff review
 *  component (in the slice, and `MobileDiffReviewScreenView.tsx`, the PR-sidebar-owned screen
 *  shell) reads its colours through this merge. Callers take it through
 *  `useThemedStyles(mobileDiffReviewStyles)`. */
export function mobileDiffReviewStyles(theme: Theme) {
  return {
    ...mobileDiffReviewLayoutStyles(theme),
    ...mobileDiffReviewControlStyles(theme)
  }
}
