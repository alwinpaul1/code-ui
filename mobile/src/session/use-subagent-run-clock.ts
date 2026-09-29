import { useEffect, useState } from 'react'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import { observeSubagentRuns, type LastRosterRead, type SubagentRunClock } from './mobile-subagent-runs'

/**
 * The run clock for one pane, kept OUTSIDE the component: the tasks sheet
 * mounts on demand, and a clock that died with it would call every run
 * "unknown" again each time the sheet opened. The chat header's running-task
 * count observes the same status while the chat is open, so the clock keeps
 * counting between openings. Bounded by the panes seen this launch.
 */
const clocks = new Map<string, { runs: SubagentRunClock; lastRead: LastRosterRead; read: RosterStatus }>()
const CLOCK_CAP = 64

type RosterStatus = Pick<AgentStatusEntry, 'subagents'> &
  Partial<Pick<AgentStatusEntry, 'paneKey' | 'prompt' | 'stateHistory' | 'sessionBoundary'>>

/**
 * Whether a status is Orca's stand-in, which says nothing of the roster: built
 * from the terminal title in place of the pane's hook row, with the pane's key
 * and state, no prompt, no history and no `subagents` (the title-only branch
 * of Orca 1.4.216's status projection; agent-status-stand-in.ts). The clock
 * reads the task readers' status, which is the held hook row through a
 * stand-in while the phone watched the pane, so one reaches it here only when
 * read as it comes; the task reader reports the others
 * (`markSubagentRosterUnseen`). Read as a roster it emptied the clock, and the
 * next real status brought every subagent still running back as just
 * started: the sheet read seconds beside the desk's "1h 15m" (the user,
 * 2026-09-29). Skipped, it marks the pane's roster unseen
 * (mobile-subagent-runs.ts).
 */
function isStandIn(status: RosterStatus): boolean {
  return (
    status.subagents === undefined &&
    (status.prompt ?? '').trim() === '' &&
    (status.stateHistory?.length ?? 0) === 0 &&
    status.sessionBoundary !== true
  )
}

/** Advance the pane's clock by this snapshot and return it. Pure per snapshot:
 *  the same status read again changes nothing, so both readers may call it,
 *  and a reader that mounts while a stand-in is read through (the held row)
 *  does not take that row for a new roster, which would clear the stand-in's
 *  mark. */
export function advanceSubagentRunClock(
  status: RosterStatus | null | undefined,
  now: number
): SubagentRunClock | undefined {
  const key = status?.paneKey
  if (!status || !key) {
    return undefined
  }
  const pane = clocks.get(key)
  if (pane?.read === status) {
    return pane.runs
  }
  if (isStandIn(status)) {
    markSubagentRosterUnseen(key)
    return pane?.runs
  }
  const next = observeSubagentRuns(pane?.runs ?? null, status.subagents, now, pane?.lastRead)
  const hostStarts = new Map<string, number>()
  for (const row of status.subagents ?? []) {
    if (row.state !== 'idle' && typeof row.startedAt === 'number') {
      hostStarts.set(row.id, row.startedAt)
    }
  }
  if (!pane && clocks.size >= CLOCK_CAP) {
    const oldest = clocks.keys().next()
    if (!oldest.done) {
      clocks.delete(oldest.value)
    }
  }
  clocks.set(key, { runs: next, lastRead: { hostStarts, unseen: false }, read: status })
  return next
}

/** A stand-in hid the pane's roster: said by the task reader for one it read
 *  through, which the clock never sees (agent-status-stand-in.ts). */
export function markSubagentRosterUnseen(paneKey: string): void {
  const pane = clocks.get(paneKey)
  if (pane && !pane.lastRead.unseen) {
    clocks.set(paneKey, { ...pane, lastRead: { ...pane.lastRead, unseen: true } })
  }
}

export function useSubagentRunClock(status: RosterStatus | null | undefined): SubagentRunClock | undefined {
  // Advanced in an effect, not during render: the observation is stamped
  // with the phone's clock, which render must not read. The sheet's first
  // paint reads the pane's clock as it stands and catches up a frame later.
  const [clock, setClock] = useState<SubagentRunClock | undefined>(() =>
    status?.paneKey ? clocks.get(status.paneKey)?.runs : undefined
  )
  useEffect(() => {
    setClock(advanceSubagentRunClock(status, Date.now()))
  }, [status])
  return clock
}

/** Test seam. */
export function resetSubagentRunClocksForTest(): void {
  clocks.clear()
}
