import { SESSION_ROUTE_AGENT_PARAM, worktreeRowOpensClaude } from '../session/session-route-agent-hint'
import type { Worktree } from '../worktree/workspace-list-types'

/**
 * The session route a tapped workspace row opens.
 *
 * `?? ''` and not a cast: the hook takes `hostId` optional and every other member guards it, so an
 * absent one builds `/h//session/...` — a pathname the shell's segment rule refuses — rather than
 * the string "undefined", which it would accept as a host named undefined.
 *
 * `agent=claude` when the row's agents say the session opens on Claude, so a workspace the phone
 * has never cached loads behind Clawd rather than a bare spinner (session-route-agent-hint.ts).
 */
export function worktreeSessionPath(
  hostId: string | undefined,
  item: Pick<Worktree, 'worktreeId' | 'displayName' | 'repo'> & Parameters<typeof worktreeRowOpensClaude>[0]
): string {
  const agent = worktreeRowOpensClaude(item) ? `&${SESSION_ROUTE_AGENT_PARAM}=claude` : ''
  return `/h/${encodeURIComponent(hostId ?? '')}/session/${encodeURIComponent(item.worktreeId)}?name=${encodeURIComponent(item.displayName || item.repo)}${agent}`
}
