import { useMemo, useRef } from 'react'
import { useAgentHudBeacon } from './agent-hud-beacon'
import { rememberFinishedTaskIds } from './mobile-finished-task-id-memory'

const NONE: readonly string[] = []

/** Background-task ids the active tab's HUD beacon reports finished.
 *
 *  Why the beacon and not the transcript: a task that ends while Claude is
 *  still working is recorded as a queue-operation notification Orca's reader
 *  never surfaces, so without this the row stays "running" until the turn
 *  ends. See `docs/mobile-background-tasks.md`.
 *
 *  Why the ids are remembered rather than read fresh: the beacon can only name
 *  what is still inside the tail of the transcript it reads, and a busy
 *  session scrolls past that in well under two minutes. See
 *  `mobile-finished-task-id-memory.ts`. Memory is per terminal handle, so
 *  switching tabs never carries one tab's finished ids into another. */
export function useActiveTabFinishedTaskIds(handle: string | null): readonly string[] {
  const memory = useRef<{ handle: string | null; ids: readonly string[] }>({
    handle,
    ids: NONE
  })
  const reported = useAgentHudBeacon(handle)?.doneTaskIds ?? NONE
  if (memory.current.handle !== handle) {
    memory.current = { handle, ids: NONE }
  }
  memory.current = {
    handle,
    ids: rememberFinishedTaskIds(memory.current.ids, reported)
  }
  return memory.current.ids
}

export type ActiveTabBackgroundTaskReport = {
  /** Ids the beacon has ever named finished, remembered across refreshes. */
  finishedTaskIds: readonly string[]
  /** What the agent's own Stop hook says is still running, or null before it
   *  has answered. Null and empty differ: empty means nothing is running,
   *  which is what clears the row on the last task. */
  runningTaskIds: readonly string[] | null
  /** Every shell the beacon saw launched in the transcript tail. */
  launchedTaskIds: readonly string[]
}

/** What the agent has said about its background work, all three halves. */
export function useActiveTabBackgroundTaskReport(
  handle: string | null
): ActiveTabBackgroundTaskReport {
  const finishedTaskIds = useActiveTabFinishedTaskIds(handle)
  const beacon = useAgentHudBeacon(handle)
  const runningTaskIds = beacon?.runningTaskIds ?? null
  const launchedTaskIds = beacon?.launchedTaskIds ?? NONE
  return useMemo(
    () => ({ finishedTaskIds, runningTaskIds, launchedTaskIds }),
    [finishedTaskIds, runningTaskIds, launchedTaskIds]
  )
}
