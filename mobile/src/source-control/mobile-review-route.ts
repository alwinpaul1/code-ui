import type { MobileGitStagingArea } from './mobile-git-status'

export type MobileReviewRouteArea = MobileGitStagingArea | 'branch'

export type MobileReviewRouteTarget = {
  hostId: string
  worktreeId: string
  worktreeName: string
  filePath: string
  area: MobileReviewRouteArea
}

export function buildMobileReviewFileRoute(target: MobileReviewRouteTarget): string {
  const params = new URLSearchParams()
  // Why: open the tapped file first (via file/area) while keeping the full
  // changed-file queue so next/previous still walks every file — scope is the
  // queue filter, not the position, so it stays 'all'.
  params.set('scope', 'all')
  params.set('file', target.filePath)
  params.set('area', target.area)
  if (target.worktreeName) {
    params.set('name', target.worktreeName)
  }
  return `/h/${encodeURIComponent(target.hostId)}/review/${encodeURIComponent(
    target.worktreeId
  )}?${params.toString()}`
}

/** The whole worktree's changes, from the chat's diff pill: no file picked,
 *  so the review opens on its own first file with every change queued. */
export function sessionReviewRoute(target: {
  hostId: string
  worktreeId: string
  worktreeName?: string | null
}): string {
  const params = new URLSearchParams()
  params.set('scope', 'all')
  if (target.worktreeName) {
    params.set('name', target.worktreeName)
  }
  return `/h/${encodeURIComponent(target.hostId)}/review/${encodeURIComponent(
    target.worktreeId
  )}?${params.toString()}`
}
