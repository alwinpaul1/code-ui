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
 * The count comes from the HUD beacon, which only the active tab's stream
 * carries — an inactive tab's beacon is whatever it said when it was last
 * open, so it is never used for one.
 */
export type SessionTabActivity =
  | { kind: 'working' }
  | { kind: 'background'; count: number | null }

export function sessionTabActivity(
  status: Pick<AgentStatusEntry, 'state' | 'workingMode'> | null | undefined,
  beacon: Pick<AgentHudBeacon, 'runningTaskIds' | 'doneTaskIds' | 'launchedTaskIds'> | null,
  active: boolean
): SessionTabActivity | null {
  if (!status || status.state !== 'working') {
    return null
  }
  if (status.workingMode !== 'monitoring') {
    return { kind: 'working' }
  }
  const launched = beacon?.launchedTaskIds ?? []
  if (!active || !beacon || (!beacon.runningTaskIds && launched.length === 0)) {
    return { kind: 'background', count: null }
  }
  const done = new Set(beacon.doneTaskIds)
  const running = new Set(
    [...(beacon.runningTaskIds ?? []), ...launched].filter((id) => !done.has(id))
  ).size
  // The agent has written every listed shell as done while the host still
  // says monitoring: nothing is running as far as anyone can tell — no chip,
  // and no "0" (council review, 2026-09-11).
  return running === 0 ? null : { kind: 'background', count: running }
}
