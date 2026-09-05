import type { MobileSessionTab } from './mobile-session-route-types'

// Why: the session screen starts every project visit with an empty tab list
// and a "Loading tabs" spinner until the host answers. Remembering the last
// accepted tabs per project lets a revisit paint the strip and the last tab at
// once; the next snapshot replaces it as usual.

const MAX_WORKTREES = 12
const tabsByWorktree = new Map<string, MobileSessionTab[]>()

export function sessionTabsCacheKey(hostId: string, worktreeId: string): string {
  return `${hostId}\0${worktreeId}`
}

export function readCachedSessionTabs(key: string): MobileSessionTab[] {
  return tabsByWorktree.get(key) ?? []
}

export function writeCachedSessionTabs(key: string, tabs: MobileSessionTab[]): void {
  tabsByWorktree.delete(key)
  tabsByWorktree.set(key, tabs)
  while (tabsByWorktree.size > MAX_WORKTREES) {
    const oldest = tabsByWorktree.keys().next().value
    if (oldest === undefined) {
      break
    }
    tabsByWorktree.delete(oldest)
  }
}

export function resetSessionTabsCacheForTests(): void {
  tabsByWorktree.clear()
}
