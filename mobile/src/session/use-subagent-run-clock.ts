import { useEffect, useState } from 'react'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import { observeSubagentRuns, type LastRosterRead, type SubagentRunClock } from './mobile-subagent-runs'

/**
 * The run clock for one pane, kept OUTSIDE the component: the tasks sheet
 * mounts on demand, and a clock that died with it would call every run
 * "unknown" again each time the sheet opened. The chat header's running-task
 * count observes the same status while the chat is open, so the clock keeps
 * counting between openings. Bounded by the panes seen this launch: past the
 * cap, the pane observed least recently goes (keep).
 */
type PaneClock = { runs: SubagentRunClock; lastRead: LastRosterRead }
const clocks = new Map<string, PaneClock>()
export const CLOCK_CAP = 64

/**
 * Store the pane's clock as the one observed most recently. Delete, then set:
 * `set` on a key the Map holds keeps its first place in the order, so past the
 * cap the pane seen FIRST went, which is usually the long-lived one the user
 * works in, and its next status read every running subagent as already
 * working when the phone began watching (review, 2026-09-30). getScopedRecord
 * in use-mobile-native-chat-session-options.ts keeps the same rule.
 */
function keep(key: string, clock: PaneClock): void {
  clocks.delete(key)
  if (clocks.size >= CLOCK_CAP) {
    const oldest = clocks.keys().next()
    if (!oldest.done) {
      clocks.delete(oldest.value)
    }
  }
  clocks.set(key, clock)
}

type RosterStatus = Pick<AgentStatusEntry, 'subagents'> &
  Partial<Pick<AgentStatusEntry, 'paneKey' | 'prompt' | 'stateHistory' | 'sessionBoundary'>>

/**
 * Whether a status is Orca's stand-in, which says nothing of the roster: built
 * from the terminal title in place of the pane's hook row, with the pane's key
 * and state, no prompt, no history and no `subagents` (the title-only branch
 * of Orca 1.4.216's status projection; agent-status-stand-in.ts). The clock
 * reads the task readers' status, which is the held hook row through a
 * stand-in while the phone watched the pane, so one reaches it only when read
 * as it comes, as it reaches the task memory. Read as a roster it emptied the
 * clock, and the next real status brought every subagent still running back
 * as just started: the sheet read seconds beside the desk's "1h 15m" (the
 * user, 2026-09-29). Skipped, it marks the pane's roster unseen
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
 *  the same roster observed twice changes nothing, so both readers may call it. */
export function advanceSubagentRunClock(
  status: RosterStatus | null | undefined,
  now: number
): SubagentRunClock | undefined {
  const key = status?.paneKey
  if (!status || !key) {
    return undefined
  }
  const pane = clocks.get(key)
  if (isStandIn(status)) {
    // Still an observation of the pane: it is the one in use.
    if (pane) {
      keep(key, pane.lastRead.unseen ? pane : { ...pane, lastRead: { ...pane.lastRead, unseen: true } })
    }
    return pane?.runs
  }
  const next = observeSubagentRuns(pane?.runs ?? null, status.subagents, now, pane?.lastRead)
  const hostStarts = new Map<string, number>()
  for (const row of status.subagents ?? []) {
    if (row.state !== 'idle' && typeof row.startedAt === 'number') {
      hostStarts.set(row.id, row.startedAt)
    }
  }
  keep(key, { runs: next, lastRead: { hostStarts, unseen: false } })
  return next
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
