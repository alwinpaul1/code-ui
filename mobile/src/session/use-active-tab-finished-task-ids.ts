import { useMemo, useRef } from 'react'
import type { AgentHudBeacon } from './agent-hud-beacon'
import type { ScreenTaskCompletion } from './mobile-background-tasks'
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
 *  `mobile-finished-task-id-memory.ts`. Memory is per terminal handle AND
 *  session, so switching tabs never carries one tab's finished ids into
 *  another, and a new session in the same terminal starts with none.
 *
 *  The beacon comes in from the caller, already gated to the session the tab
 *  is showing (`agentHudBeaconMatches`): the store is keyed by handle, and a
 *  handle outlives the process that emitted into it, so reading it here by
 *  handle fed a dead process's lists to the row (2026-09-18). */
export function useActiveTabFinishedTaskIds(
  handle: string | null,
  sessionId: string | null,
  beacon: AgentHudBeacon | null
): readonly string[] {
  const memory = useRef<{ handle: string | null; sessionId: string | null; ids: readonly string[] }>({
    handle,
    sessionId,
    ids: NONE
  })
  const reported = beacon?.doneTaskIds ?? NONE
  // A null session id is "not known yet", never "a different session".
  const sessionChanged =
    sessionId !== null && memory.current.sessionId !== null && sessionId !== memory.current.sessionId
  if (memory.current.handle !== handle || sessionChanged) {
    memory.current = { handle, sessionId, ids: NONE }
  }
  memory.current = {
    handle,
    sessionId: sessionId ?? memory.current.sessionId,
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
  /** When that answer arrived (phone clock, epoch ms); null when it has not. */
  runningTaskIdsAt: number | null
  /** Every shell the beacon saw launched in the transcript tail. */
  launchedTaskIds: readonly string[]
  /** How many shells the agent's own footer says are running, read off the
   *  screen. The truthful floor when the beacon's transcript tail cannot reach
   *  a shell's launch on a huge session; null when no footer count is on screen. */
  onScreenShellCount?: number | null
  /** Completions the agent stated on its screen, remembered since this tab's
   *  session came on screen (`use-active-tab-screen-completions.ts`). */
  screenCompletions?: readonly ScreenTaskCompletion[]
}

/** What the agent has said about its background work, all three halves, from
 *  the beacon of the session this tab is showing and no other. */
export function useActiveTabBackgroundTaskReport(args: {
  handle: string | null
  sessionId: string | null
  /** Already session-gated by the caller; see `useActiveTabFinishedTaskIds`. */
  beacon: AgentHudBeacon | null
}): ActiveTabBackgroundTaskReport {
  const { handle, sessionId, beacon } = args
  const finishedTaskIds = useActiveTabFinishedTaskIds(handle, sessionId, beacon)
  const runningTaskIds = beacon?.runningTaskIds ?? null
  const runningTaskIdsAt = beacon?.runningTaskIdsAt ?? null
  const launchedTaskIds = beacon?.launchedTaskIds ?? NONE
  return useMemo(
    () => ({ finishedTaskIds, runningTaskIds, runningTaskIdsAt, launchedTaskIds }),
    [finishedTaskIds, runningTaskIds, runningTaskIdsAt, launchedTaskIds]
  )
}
