import { useEffect, useState } from 'react'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import { observeSubagentRuns, type SubagentRunClock } from './mobile-subagent-runs'

/**
 * The run clock for one pane, kept OUTSIDE the component: the tasks sheet
 * mounts on demand, and a clock that died with it would call every run
 * "unknown" again each time the sheet opened. The chat header's running-task
 * count observes the same status while the chat is open, so the clock keeps
 * counting between openings. Bounded by the panes seen this launch.
 */
const clocks = new Map<string, SubagentRunClock>()
const CLOCK_CAP = 64

type RosterStatus = Pick<AgentStatusEntry, 'subagents'> & Partial<Pick<AgentStatusEntry, 'paneKey'>>

/** Advance the pane's clock by this snapshot and return it. Pure per snapshot:
 *  the same roster observed twice changes nothing, so both readers may call it. */
export function advanceSubagentRunClock(
  status: RosterStatus | null | undefined,
  now: number
): SubagentRunClock | undefined {
  const key = status?.paneKey
  if (!status || !key) {
    return undefined
  }
  const previous = clocks.get(key) ?? null
  const next = observeSubagentRuns(previous, status.subagents, now)
  if (!clocks.has(key) && clocks.size >= CLOCK_CAP) {
    const oldest = clocks.keys().next()
    if (!oldest.done) {
      clocks.delete(oldest.value)
    }
  }
  clocks.set(key, next)
  return next
}

export function useSubagentRunClock(status: RosterStatus | null | undefined): SubagentRunClock | undefined {
  // Advanced in an effect, not during render: the observation is stamped
  // with the phone's clock, which render must not read. The sheet's first
  // paint reads the pane's clock as it stands and catches up a frame later.
  const [clock, setClock] = useState<SubagentRunClock | undefined>(() =>
    status?.paneKey ? clocks.get(status.paneKey) : undefined
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
