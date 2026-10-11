import { useEffect, useMemo, useState } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { BackgroundTasks } from './mobile-background-tasks'
import type { RosterRow } from './mobile-background-task-roster'
import { EMPTY_FINISHED_SUBAGENT_ROWS, keepFinishedSubagentRows, type FinishedSubagentRows } from './subagent-finished-rows'
import { mergeSubagentActivity, subagentWatchTargets } from './mobile-subagent-activity'
import {
  stopWatchingSubagentActivity,
  useSubagentActivityFeeds,
  watchSubagentActivity
} from './subagent-activity-store'
import type { ActiveTabBackgroundTaskReport } from './use-active-tab-finished-task-ids'

/** Which agent the tab runs and where its transcript is: what a running
 *  subagent's own file is found by (`mobile-subagent-transcript.ts`). */
export type SubagentActivitySource = { agent: string | null; parentTranscriptPath: string | null }

/** Asks for the running agents' transcripts while `source` is set, and folds
 *  what comes back into the sheet's tasks (`mobile-subagent-activity.ts`).
 *  Null `source` asks for nothing and returns `tasks` as it came, so a closed
 *  sheet, a structured tab and a Codex tab read no file at all. */
export function useSubagentActivityWatch(args: {
  tasks: BackgroundTasks
  source: SubagentActivitySource | null
  report: ActiveTabBackgroundTaskReport | undefined
  /** The host's roster, which says whether an agent a read subagent launched
   *  still runs. Null: none such is listed. */
  hostSubagents?: readonly RosterRow[] | null
  now: number
}): BackgroundTasks {
  const { tasks, source, report, now } = args
  const hostSubagents = args.hostSubagents ?? null
  const [owner] = useState(() => ({}))
  const agent = source?.agent ?? null
  const parentTranscriptPath = source?.parentTranscriptPath ?? null
  const watching = source !== null
  const targets = useMemo(
    () => (watching ? subagentWatchTargets({ agent, running: tasks.running, parentTranscriptPath }) : []),
    [agent, parentTranscriptPath, tasks.running, watching]
  )
  // The store ignores a list equal to the one it holds, so the per-second
  // re-derive does not tear the reads down.
  useEffect(() => watchSubagentActivity(owner, targets), [owner, targets])
  useEffect(() => () => stopWatchingSubagentActivity(owner), [owner])
  const allFeeds = useSubagentActivityFeeds()
  const feeds = useMemo(() => {
    const own = new Map<string, readonly NativeChatMessage[]>()
    for (const target of targets) {
      const messages = allFeeds.get(target.agentId)
      if (messages) {
        own.set(target.agentId, messages)
      }
    }
    return own
  }, [allFeeds, targets])
  const stopIds = report?.stopRunningTaskIds ?? null
  const stopAt = report?.stopRunningTaskIdsAt ?? null
  const liveShellCount = report?.onScreenShellCount ?? null
  const heldShellCount = report?.heldOnScreenShellCount ?? null
  const finishedTaskIds = report?.finishedTaskIds
  const merged = useMemo(
    () =>
      mergeSubagentActivity(tasks, feeds, {
        now,
        liveShellCount,
        heldShellCount,
        stopRunning: stopIds === null ? null : { ids: stopIds, at: stopAt },
        hostSubagents,
        ...(finishedTaskIds ? { finishedTaskIds } : {})
      }),
    [feeds, finishedTaskIds, heldShellCount, hostSubagents, liveShellCount, now, stopAt, stopIds, tasks]
  )
  return useMemo(() => (watching ? recallFinishedRows(parentTranscriptPath, tasks, merged) : merged), [merged, parentTranscriptPath, tasks, watching])
}

/** Per session (its transcript path), for as long as the app runs: the sheet
 *  unmounts when it closes, and a subagent that handed back while it was
 *  closed must still find its finished rows (`subagent-finished-rows.ts`).
 *  Bounded like the other session memories here. */
const finishedRowMemories = new Map<string, FinishedSubagentRows>()
const FINISHED_ROW_SESSIONS_MAX = 8

function recallFinishedRows(key: string | null, lane: BackgroundTasks, merged: BackgroundTasks): BackgroundTasks {
  if (key === null) {
    return merged
  }
  const kept = keepFinishedSubagentRows(finishedRowMemories.get(key) ?? EMPTY_FINISHED_SUBAGENT_ROWS, lane, merged)
  finishedRowMemories.delete(key)
  finishedRowMemories.set(key, kept.memory)
  if (finishedRowMemories.size > FINISHED_ROW_SESSIONS_MAX) {
    const oldest = finishedRowMemories.keys().next().value
    if (oldest !== undefined) {
      finishedRowMemories.delete(oldest)
    }
  }
  return kept.tasks
}

export function resetFinishedSubagentRowsForTests(): void {
  finishedRowMemories.clear()
}
