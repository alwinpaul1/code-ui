/**
 * The session route's hint of which agent it opens on, set by the list row the user tapped
 * (`?agent=claude`), for a workspace the phone has never cached: with no tabs cached, the tapped
 * row's agent list is the only evidence the phone holds before `session.tabs.list` answers. Only
 * `claude` is ever written; anything else means no hint.
 */
export const SESSION_ROUTE_AGENT_PARAM = 'agent'

export type SessionRouteAgentHint = 'claude' | null

export function readSessionRouteAgentHint(value: string | string[] | undefined): SessionRouteAgentHint {
  const first = Array.isArray(value) ? value[0] : value
  return first === 'claude' ? 'claude' : null
}

/**
 * Whether a tapped workspace row says its session opens on Claude: it lists at least one agent,
 * every top-level agent in it is Claude, and it has no more live terminals than those agents, so
 * no plain shell or other agent could be the tab it opens on. Any doubt is no hint: Clawd on a
 * terminal or a Codex workspace would be a wrong claim, a spinner on a Claude one only a plain one.
 */
export function worktreeRowOpensClaude(row: {
  agents?: readonly { agentType: string | null; parentPaneKey: string | null }[]
  liveTerminalCount?: number
}): boolean {
  const topLevel = (row.agents ?? []).filter((agent) => agent.parentPaneKey === null)
  if (topLevel.length === 0 || !topLevel.every((agent) => agent.agentType === 'claude')) {
    return false
  }
  return (row.liveTerminalCount ?? 0) <= topLevel.length
}
