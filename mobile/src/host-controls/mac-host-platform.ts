import type { HomeWorktreeSummary, HostWorktreeInfo } from '../worktree/home-worktree-info'

/** Reads the `host.platform` RPC result. Unknown or missing stays null so the sheet
 *  shows nothing rather than guessing a platform the host never claimed. */
export function readMacHostPlatformResult(result: unknown): NodeJS.Platform | null {
  const platform = (result as { platform?: unknown } | null)?.platform
  return typeof platform === 'string' && platform ? (platform as NodeJS.Platform) : null
}

/** The workspace whose terminal carries the command: the host's last active one, else
 *  the first it has listed. Null means the Mac has no workspace and the rows stay
 *  disabled with a reason instead of failing on tap. */
export function selectMacHostWorktreeId(
  info: HostWorktreeInfo | undefined,
  cachedWorktrees: unknown[] | null
): string | null {
  const lastActive = info?.lastActiveWorktree?.worktreeId
  if (typeof lastActive === 'string' && lastActive) {
    return lastActive
  }
  for (const row of cachedWorktrees ?? []) {
    const id = (row as HomeWorktreeSummary | null)?.worktreeId
    if (typeof id === 'string' && id) {
      return id
    }
  }
  return null
}
