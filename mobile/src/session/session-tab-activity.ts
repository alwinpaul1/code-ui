import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { AgentHudBeacon } from './agent-hud-beacon'
import { agentHudBeaconSpeaksFor } from './hud-beacon-fields'

/**
 * What a tab pill says about its agent's work, for every tab in the strip,
 * not only the active one.
 *
 * The source is the host's own hook status, which `session.tabs.subscribe`
 * pushes for all tabs whether or not the phone holds their byte stream: Orca
 * keeps a pane `working` in `monitoring` mode while Claude's Stop hook still
 * lists background shells, and flips it to `done` when the last one reports.
 * The HUD beacon, which only the active tab's stream carries, can only
 * retire that state early; an inactive tab's beacon is whatever it said when
 * it was last open, so it is never consulted for one.
 *
 * Nor is a beacon from another session: the store is keyed by terminal
 * handle, and a handle outlives the process that emitted into it, so the last
 * word of a phone-launched agent ("every shell I knew of has finished") could
 * retire the dot of the hand-started session that took over its terminal
 * while the host still listed that session's shells (2026-09-18). The beacon
 * must name the session the tab is showing, as `agentHudBeaconMatches` says.
 */
export type SessionTabActivity = 'working' | 'background'

export function sessionTabActivity(
  status: Pick<AgentStatusEntry, 'state' | 'workingMode'> | null | undefined,
  beacon: Pick<
    AgentHudBeacon,
    'sessionId' | 'runningTaskIds' | 'doneTaskIds' | 'launchedTaskIds'
  > | null,
  active: boolean,
  /** The tab's own session (`agentStatus.providerSession.id`), or null while
   *  it does not know one yet. */
  sessionId: string | null
): SessionTabActivity | null {
  if (!status || status.state !== 'working') {
    return null
  }
  if (status.workingMode !== 'monitoring') {
    return 'working'
  }
  // The pill shows the state, never a number (asked for 2026-09-11); the
  // chat view's row carries the count. But the active tab's beacon can say
  // every shell the host still lists has already finished — then nothing is
  // running as far as anyone can tell, and the pill shows nothing.
  if (active && beacon && agentHudBeaconSpeaksFor(beacon, sessionId)) {
    const launched = beacon.launchedTaskIds ?? []
    if (beacon.runningTaskIds || launched.length > 0) {
      const done = new Set(beacon.doneTaskIds)
      const running = [...(beacon.runningTaskIds ?? []), ...launched].some((id) => !done.has(id))
      if (!running) {
        return null
      }
    }
  }
  return 'background'
}
