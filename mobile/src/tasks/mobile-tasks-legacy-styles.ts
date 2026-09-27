import type { Theme } from '../theme/theme-context'
import type { ThemeColors } from '../theme/tokens'
import { mobileTasksChromeStyles } from './mobile-tasks-chrome-styles'
import { mobileTasksListStyles } from './mobile-tasks-list-styles'
import { mobileTasksProjectPickerStyles } from './mobile-tasks-project-picker-styles'
import { mobileTasksDetailStyles } from './mobile-tasks-detail-styles'
import { mobileTasksWorkspaceReviewStyles } from './mobile-tasks-workspace-review-styles'
import { mobileTasksDiffCommentStyles } from './mobile-tasks-diff-comment-styles'
import { mobileTasksComposerActionStyles } from './mobile-tasks-composer-action-styles'

function buildMobileTasksStyles(theme: Theme) {
  return {
    ...mobileTasksChromeStyles(theme),
    ...mobileTasksListStyles(theme),
    ...mobileTasksProjectPickerStyles(theme),
    ...mobileTasksDetailStyles(theme),
    ...mobileTasksWorkspaceReviewStyles(theme),
    ...mobileTasksDiffCommentStyles(theme),
    ...mobileTasksComposerActionStyles(theme)
  }
}

export type MobileTasksStyles = ReturnType<typeof buildMobileTasksStyles>

// One set per palette. `useThemedStyles` memoises per component instance, and every TasksRow and
// TasksButton on the surface (about 135) reads this, so without the cache each would build all
// seven sheets on mount. The factories read nothing but `colors`, and `lightColors` /
// `darkColors` are module constants, so the palette object is a sound key.
const stylesByPalette = new WeakMap<ThemeColors, MobileTasksStyles>()

/** The whole Tasks surface's styles for the live theme: `useThemedStyles(mobileTasksStyles)`. */
export function mobileTasksStyles(theme: Theme): MobileTasksStyles {
  const cached = stylesByPalette.get(theme.colors)
  if (cached) {
    return cached
  }
  const built = buildMobileTasksStyles(theme)
  stylesByPalette.set(theme.colors, built)
  return built
}

export function getPrSignalToneStyle(
  styles: MobileTasksStyles,
  tone: 'neutral' | 'success' | 'warning' | 'danger'
) {
  if (tone === 'success') {
    return styles.prSignalSuccess
  }
  if (tone === 'warning') {
    return styles.prSignalWarning
  }
  if (tone === 'danger') {
    return styles.prSignalDanger
  }
  return null
}

export function getGitLabPipelineStatusStyle(styles: MobileTasksStyles, status: string) {
  switch (status) {
    case 'success':
      return styles.pipelineStatusSuccess
    case 'failed':
      return styles.pipelineStatusDanger
    case 'manual':
      return styles.pipelineStatusWarning
    case 'running':
    case 'pending':
    case 'created':
    case 'preparing':
    case 'waiting_for_resource':
    case 'scheduled':
      return styles.pipelineStatusActive
    case 'canceled':
    case 'skipped':
    default:
      return null
  }
}
