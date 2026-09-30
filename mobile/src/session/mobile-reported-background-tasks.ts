import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { deriveBackgroundTasks, type BackgroundTaskHostStatus, type BackgroundTasks } from './mobile-background-tasks'
import type { SubagentRunClock } from './mobile-subagent-runs'
import type { ActiveTabBackgroundTaskReport } from './use-active-tab-finished-task-ids'

/** The terminal tab's background work, from the transcript, the host status
 *  and everything the tab's report carries. One call for the status line's
 *  count and for the tasks sheet, so the two can never read the report
 *  differently. A host status missing for a moment is bridged by the last one
 *  the report holds (`use-active-tab-task-report.ts`). */
export function deriveReportedBackgroundTasks(
  messages: readonly NativeChatMessage[],
  now: number,
  hostStatus: BackgroundTaskHostStatus | null | undefined,
  report: ActiveTabBackgroundTaskReport | undefined,
  subagentRuns?: SubagentRunClock
): BackgroundTasks {
  return deriveBackgroundTasks(messages, now, hostStatus ?? report?.heldAgentStatus ?? null, {
    finishedTaskIds: report?.finishedTaskIds ?? [],
    runningTaskIds: report?.runningTaskIds ?? null,
    runningTaskIdsAt: report?.runningTaskIdsAt ?? null,
    launchedTaskIds: report?.launchedTaskIds ?? [],
    stopRunningTaskIds: report?.stopRunningTaskIds ?? null,
    stopRunningTaskIdsAt: report?.stopRunningTaskIdsAt ?? null,
    onScreenShellCount: report?.onScreenShellCount ?? null,
    heldOnScreenShellCount: report?.heldOnScreenShellCount ?? null,
    leadOnlyShellCount: report?.leadOnlyShellCount ?? null,
    ...(report?.runBoundaryAt === undefined ? {} : { runBoundaryAt: report.runBoundaryAt }),
    screenCompletions: report?.screenCompletions ?? [],
    agentProvenance: report?.agentProvenance ?? null,
    ...(subagentRuns ? { subagentRuns } : {})
  })
}
