import { useEffect, useMemo, useState } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { BackgroundTasks } from './mobile-background-tasks'
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
  now: number
}): BackgroundTasks {
  const { tasks, source, report, now } = args
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
  return useMemo(
    () =>
      mergeSubagentActivity(tasks, feeds, {
        now,
        liveShellCount,
        heldShellCount,
        stopRunning: stopIds === null ? null : { ids: stopIds, at: stopAt },
        ...(finishedTaskIds ? { finishedTaskIds } : {})
      }),
    [feeds, finishedTaskIds, heldShellCount, liveShellCount, now, stopAt, stopIds, tasks]
  )
}
