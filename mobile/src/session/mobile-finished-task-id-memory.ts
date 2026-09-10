/** Background-task ids the beacon has named finished, remembered across
 *  refreshes.
 *
 *  Why remember at all: the status line reads a fixed tail of Claude's
 *  transcript, so a completion is only named for as long as it stays inside
 *  that window. Measured 2026-09-10 against a 40 MB transcript (Claude Code
 *  2.1.266): the window held 87 seconds of records, and a subagent's failure
 *  notice was 1.27 MB behind the end by the next refresh. The phone kept only
 *  the newest beacon's list, so the id vanished and a dead agent sat in the
 *  running row. Keeping the union means an id has to be seen once, not
 *  continuously. */

/** Enough for a long session's worth of tasks; old ids are dropped first. */
export const FINISHED_TASK_ID_MEMORY_MAX = 512

/** The union of what was already remembered and what this beacon named, oldest
 *  first. Returns the SAME array when nothing new arrived, so a subscriber does
 *  not re-render on every beacon. */
export function rememberFinishedTaskIds(
  remembered: readonly string[],
  reported: readonly string[]
): readonly string[] {
  const known = new Set(remembered)
  let added: string[] | null = null
  for (const id of reported) {
    if (id.length === 0 || known.has(id)) {
      continue
    }
    known.add(id)
    ;(added ??= []).push(id)
  }
  if (added === null) {
    return remembered
  }
  const next = [...remembered, ...added]
  return next.length > FINISHED_TASK_ID_MEMORY_MAX
    ? next.slice(next.length - FINISHED_TASK_ID_MEMORY_MAX)
    : next
}
