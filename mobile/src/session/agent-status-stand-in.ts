import type { AgentStatusEntry, AgentSubagentSnapshot } from '../../../src/shared/agent-status-types'

type StatusFields = Partial<Pick<AgentStatusEntry, 'state' | 'paneKey' | 'prompt' | 'stateHistory' | 'sessionBoundary' | 'subagents'>>

/**
 * Whether a status is Orca's stand-in: built from the terminal title when the
 * pane's hook row goes stale, as it does over a long tool call, with the
 * pane's key and a state from the title, no prompt, no history, no roster and
 * no session boundary (the title-only branch of Orca 1.4.216's status
 * projection, read in its app.asar 2026-09-29). It says nothing about the
 * prompt (agent-status-prompts.ts) or the roster.
 */
export function isOrcaStandIn(status: StatusFields): boolean {
  return (
    status.subagents === undefined &&
    (status.prompt ?? '').trim() === '' &&
    (status.stateHistory?.length ?? 0) === 0 &&
    status.sessionBoundary !== true
  )
}

/** The last roster each pane's real status carried, by pane key. */
const heldRosters = new Map<string, readonly AgentSubagentSnapshot[] | undefined>()
const HELD_ROSTER_CAP = 64

/**
 * The status with the roster its pane's last real status carried, while Orca
 * stands in a working one. Read as it came, the stand-in took every roster
 * subagent off the running count and the tasks sheet for as long as it stood,
 * the task memory lost which of them the lead had not started, and the run
 * clock counted each from scratch after it: seconds on the sheet beside the
 * desk's "1h 15m" (the user, 2026-09-29). A done stand-in may be an agent
 * that exited, and is left as it came.
 */
export function withRosterHeldThroughStandIn<T extends StatusFields>(status: T | null): T | null {
  const key = status?.paneKey
  if (!status || !key) {
    return status
  }
  if (!isOrcaStandIn(status)) {
    if (!heldRosters.has(key) && heldRosters.size >= HELD_ROSTER_CAP) {
      const oldest = heldRosters.keys().next()
      if (!oldest.done) {
        heldRosters.delete(oldest.value)
      }
    }
    heldRosters.set(key, status.subagents)
    return status
  }
  const held = heldRosters.get(key)
  return status.state === 'working' && held !== undefined ? { ...status, subagents: [...held] } : status
}

/** Test seam. */
export function resetHeldRostersForTest(): void {
  heldRosters.clear()
}
