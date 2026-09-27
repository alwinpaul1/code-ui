import type { ThemeColors } from '../theme/tokens'
import { taskTime } from './mobile-tasks-item-mapping'
import type { TaskItem } from './mobile-tasks-project-workspace-types'
import type { RepoSummary } from './mobile-tasks-provider-detail-types'
import type { TaskSort } from './mobile-tasks-view-state-types'

export function isFailedGitHubCheck(check: { conclusion?: string | null }): boolean {
  return ['failure', 'cancelled', 'timed_out'].includes(check.conclusion ?? '')
}

export function repositoryCount(count: number): string {
  return `${count} ${count === 1 ? 'repository' : 'repositories'}`
}

export function buildPartialRepositoryNotice(failedCount: number, totalCount: number): string {
  return `${failedCount} of ${repositoryCount(totalCount)} failed to load.`
}

export function repoColor(name: string): string {
  const palette = ['#f97316', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f59e0b', '#6366f1']
  let hash = 0
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  return palette[Math.abs(hash) % palette.length]!
}

export function getRepoBadgeColor(repo: RepoSummary | undefined, fallbackName: string): string {
  return repo?.badgeColor || repoColor(repo?.displayName ?? fallbackName)
}

// `undefined` as well as `null`: a checked `repo.hooks` reader does not require `source`, and the
// recorded reply for a repo with no hooks file carries none.
export function setupSourceLabel(source: string | null | undefined): string {
  if (source === 'orca.yaml') {
    return 'orca.yaml'
  }
  if (source === 'legacy') {
    return 'local hooks'
  }
  return 'repository hooks'
}

/** The name a task's repository section is headed and sorted by. */
function taskRepositoryLabel(item: TaskItem, reposById: Map<string, RepoSummary>): string {
  if (item.provider === 'github' || item.provider === 'gitlab') {
    return reposById.get(item.source.repoId)?.displayName ?? item.source.repoName
  }
  return item.provider === 'gitlabTodo' ? item.source.projectPath : item.source.team.name
}

/** A task's repository section: key, label and dot colour. `colors` is the live theme's; it only
 *  fills in for a Linear state that names no colour of its own. */
export function taskRepositoryMeta(
  item: TaskItem,
  reposById: Map<string, RepoSummary>,
  colors: ThemeColors
): { key: string; label: string; color: string } {
  const label = taskRepositoryLabel(item, reposById)
  if (item.provider === 'github' || item.provider === 'gitlab') {
    return {
      key: item.source.repoId,
      label,
      color: getRepoBadgeColor(reposById.get(item.source.repoId), item.source.repoName)
    }
  }
  if (item.provider === 'gitlabTodo') {
    return {
      key: item.source.projectPath,
      label,
      color: repoColor(item.source.projectPath)
    }
  }
  return {
    key: item.source.team.id,
    label,
    color: item.source.state.color || colors.accent
  }
}

export function sortMobileTaskItems(
  items: readonly TaskItem[],
  sort: TaskSort,
  reposById: Map<string, RepoSummary>
): TaskItem[] {
  if (items.length < 2) {
    return [...items]
  }
  const byRepository = sort === 'repository'
  const collator = byRepository ? new Intl.Collator(undefined, { sensitivity: 'base' }) : null
  return items
    .map((item) => ({
      item,
      updatedAt: taskTime(item.updatedAt),
      repositoryLabel: byRepository ? taskRepositoryLabel(item, reposById) : ''
    }))
    .sort(
      (a, b) =>
        (collator?.compare(a.repositoryLabel, b.repositoryLabel) ?? 0) || b.updatedAt - a.updatedAt
    )
    .map(({ item }) => item)
}
