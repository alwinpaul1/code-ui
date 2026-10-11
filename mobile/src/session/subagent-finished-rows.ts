import type { BackgroundTask, BackgroundTasks } from './mobile-background-tasks'

// ─── A subagent's finished rows, kept after its transcript stops being read ──
//
// The open sheet reads a subagent's own transcript only while the agent runs
// (`mobile-subagent-activity.ts`), so the moment it handed back, the shells it
// had finished (and the agents it had launched) left the sheet with the read.
// The Claude app keeps them in Finished ("Run the full gate  Shell  Completed",
// the user's screenshot of 2026-10-11). This keeps every FINISHED row a read
// showed, for the session, and puts back the ones the sheet no longer lists.
//
// A row still RUNNING when its agent finished is not kept: its end was never
// seen, and saying "Completed" for it would be a guess (a timed-out command a
// subagent moved to the background can run on for hours after its agent hands
// back, session 0954729d).

/** Finished rows a subagent's transcript showed, by id, oldest first. */
export type FinishedSubagentRows = ReadonlyMap<string, BackgroundTask>

export const EMPTY_FINISHED_SUBAGENT_ROWS: FinishedSubagentRows = new Map()

/** A long session finishes hundreds of subagent shells; the sheet pages ten at a time. */
const KEPT_MAX = 200

/** Folds this render's merged list into the memory and puts back the kept
 *  rows the merged list no longer holds, right after the rows the reads
 *  added to Finished (the newest), ahead of the lead's own finished rows.
 *  `lane` is the list before the merge, so the rows the merge added are the
 *  ones it did not have. The same objects come back when nothing changed. */
export function keepFinishedSubagentRows(
  memory: FinishedSubagentRows,
  lane: BackgroundTasks,
  merged: BackgroundTasks
): { memory: FinishedSubagentRows; tasks: BackgroundTasks } {
  const laneIds = new Set([...lane.running, ...lane.finished].map((task) => task.id))
  const added = merged.finished.filter((task) => !laneIds.has(task.id))
  let next = memory
  for (const task of added) {
    // Re-derived every tick as new objects: a row is new only when what it
    // says changed, so the memory stays the same Map between ticks.
    const kept = next.get(task.id)
    if (!kept || kept.status !== task.status || kept.title !== task.title || kept.summary !== task.summary) {
      const copy = new Map(next)
      copy.delete(task.id)
      copy.set(task.id, task)
      next = copy
    }
  }
  // A kept row the merged list shows running again is not over: a footer
  // reading that dipped and came back, a roster that dropped a row and listed
  // it again. Kept, it came back as finished once its agent handed back
  // (review of 59494020b).
  const back = merged.running.filter((task) => next.has(task.id))
  if (back.length > 0) {
    const copy = new Map(next)
    for (const task of back) {
      copy.delete(task.id)
    }
    next = copy
  }
  if (next.size > KEPT_MAX) {
    next = new Map([...next].slice(next.size - KEPT_MAX))
  }
  const listed = new Set([...merged.running, ...merged.finished].map((task) => task.id))
  const restored = [...next.values()].filter((task) => !listed.has(task.id)).toReversed()
  if (restored.length === 0) {
    return { memory: next, tasks: merged }
  }
  const head = merged.finished.slice(0, added.length)
  const rest = merged.finished.slice(added.length)
  return { memory: next, tasks: { ...merged, finished: [...head, ...restored, ...rest] } }
}
