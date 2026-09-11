import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { AgentHudBeacon } from './agent-hud-beacon'

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
 */
export type SessionTabActivity = 'working' | 'background'

export function sessionTabActivity(
  status: Pick<AgentStatusEntry, 'state' | 'workingMode'> | null | undefined,
  beacon: Pick<AgentHudBeacon, 'runningTaskIds' | 'doneTaskIds' | 'launchedTaskIds'> | null,
  active: boolean
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
  if (active && beacon) {
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
