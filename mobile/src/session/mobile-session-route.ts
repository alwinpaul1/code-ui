import type { HostStackRouteTarget } from '../navigation/host-stack-navigation'

export type MobileSessionRouteParams = {
  hostId: string
  worktreeId: string
  name?: string
  /** A tab to select on arrival: the terminal pane (`<tabId>:<leafId>`) or the
   *  structured agent session a notification came from. Spent and cleared by
   *  the screen once applied. */
  tab?: { paneKey: string } | { agentSessionId: string }
}

/** Identities stay raw — the navigator owns the params, so pre-encoding a
 *  workspace id would reach the session screen still escaped. */
export function mobileSessionRouteTarget({
  hostId,
  worktreeId,
  name,
  tab
}: MobileSessionRouteParams): HostStackRouteTarget {
  return {
    name: '[hostId]/session/[worktreeId]',
    params: {
      hostId,
      worktreeId,
      ...(name ? { name } : {}),
      // Both keys, the absent one empty: a tap onto the screen already showing
      // this workspace is a SET_PARAMS, which merges, so a key left out would
      // keep an earlier tap's request alive beside this one.
      ...(tab
        ? {
            paneKey: 'paneKey' in tab ? tab.paneKey : '',
            agentSessionId: 'agentSessionId' in tab ? tab.agentSessionId : ''
          }
        : {})
    }
  }
}
