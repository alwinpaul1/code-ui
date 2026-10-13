import type { HostStackRouteTarget } from '../navigation/host-stack-navigation'

export type MobileSessionRouteParams = {
  hostId: string
  worktreeId: string
  name?: string
  /** A tab to select on arrival: the terminal pane (`<tabId>:<leafId>`) a
   *  notification came from. Spent and cleared by the screen once applied. */
  paneKey?: string
  /** The same for a structured agent session tab, by its session id. */
  agentSessionId?: string
}

/** Identities stay raw — the navigator owns the params, so pre-encoding a
 *  workspace id would reach the session screen still escaped. */
export function mobileSessionRouteTarget({
  hostId,
  worktreeId,
  name,
  paneKey,
  agentSessionId
}: MobileSessionRouteParams): HostStackRouteTarget {
  return {
    name: '[hostId]/session/[worktreeId]',
    params: {
      hostId,
      worktreeId,
      ...(name ? { name } : {}),
      ...(paneKey ? { paneKey } : {}),
      ...(agentSessionId ? { agentSessionId } : {})
    }
  }
}
