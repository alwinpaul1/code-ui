import { resolveMobileNativeChat } from './mobile-native-chat-eligibility'
import { pickCachedActiveSessionTab, readCachedSessionTabs, sessionTabsCacheKey } from './mobile-session-tabs-cache'
import type { SessionRouteAgentHint } from './session-route-agent-hint'

/**
 * Whether the route being opened is a session that will open on a Claude chat, read from the
 * phone's tab cache, so the host check that holds the whole route back while the relay dials
 * (HostProtocolGate) can draw Clawd and "Loading session…" rather than a bare spinner on an empty
 * screen (2026-10-16, from the device). The gate runs before the session screen mounts, so the
 * cache is the only thing that knows the tab; with nothing cached, it is not claimed.
 */
export function cachedSessionRouteOpensClaude(pathname: string, hostId: string | undefined): boolean {
  if (!hostId) {
    return false
  }
  const worktreeId = sessionRouteWorktreeId(pathname, hostId)
  if (worktreeId === null) {
    return false
  }
  const active = pickCachedActiveSessionTab(readCachedSessionTabs(sessionTabsCacheKey(hostId, worktreeId)))
  return resolveMobileNativeChat(active)?.agent === 'claude'
}

/** The worktree a `/h/<host>/session/<worktree>` path names, decoded, or null for any other path. */
export function sessionRouteWorktreeId(pathname: string, hostId: string): string | null {
  const match = /^\/h\/([^/]+)\/session\/([^/?#]+)/.exec(pathname)
  if (!match) {
    return null
  }
  try {
    return decodeURIComponent(match[1]!) === hostId ? decodeURIComponent(match[2]!) : null
  } catch {
    return null
  }
}

/**
 * Whether the session route being opened draws Clawd while it loads: the phone's tab cache decides
 * when it holds this workspace's tabs (it saw them itself), and only with nothing cached does the
 * tapped row's hint speak.
 */
export function sessionRouteOpensClaude(
  pathname: string,
  hostId: string | undefined,
  agentHint: SessionRouteAgentHint
): boolean {
  if (!hostId) {
    return false
  }
  const worktreeId = sessionRouteWorktreeId(pathname, hostId)
  if (worktreeId === null) {
    return false
  }
  if (readCachedSessionTabs(sessionTabsCacheKey(hostId, worktreeId)).length > 0) {
    return cachedSessionRouteOpensClaude(pathname, hostId)
  }
  return agentHint === 'claude'
}
