import type { SessionRouteAgentHint } from './session-route-agent-hint'

/** What the session screen draws while it has no tabs to draw yet: nothing (it has tabs, or they
 *  loaded empty), Clawd, or the plain spinner. */
export type MobileSessionLoadingScreen = 'claude' | 'plain' | null

/**
 * The session screen's own loading, before its first tabs: "Loading tabs" on a live connection,
 * and before the first connection too, which drew an empty terminal frame for a workspace with
 * nothing cached. Clawd only on the tapped row's word that the workspace opens on Claude
 * (session-route-agent-hint.ts); once tabs load there is no loading screen, and the real active
 * tab decides what is drawn.
 */
export function mobileSessionLoadingScreen(input: {
  terminalsLoaded: boolean
  visibleTabCount: number
  routeAgentHint: SessionRouteAgentHint
}): MobileSessionLoadingScreen {
  if (input.terminalsLoaded || input.visibleTabCount > 0) {
    return null
  }
  return input.routeAgentHint === 'claude' ? 'claude' : 'plain'
}
