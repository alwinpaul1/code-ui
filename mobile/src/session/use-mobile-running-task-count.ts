import { useMemo } from 'react'
import type { AgentSessionBackgroundTaskState } from '../../../src/shared/agent-session-wire'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { deriveBackgroundTasks, type BackgroundTask } from './mobile-background-tasks'
import { projectStructuredBackgroundTasks } from './mobile-structured-background-tasks'
import { useSubagentRunClock } from './use-subagent-run-clock'
import type { ActiveTabBackgroundTaskReport } from './use-active-tab-finished-task-ids'

/** What the tab has in flight, from the host's roster when it has one and the
 *  transcript plus beacons otherwise. Shared by the status line above the
 *  composer and the conversation's agent rows, which must never disagree with
 *  each other or with the sheet. Not ticking: the only clock-dependent rule
 *  (how old the desk's bare `monitoring` state may be) needs one reading. */
export function useMobileRunningTasks(input: {
  messages: readonly NativeChatMessage[]
  agentStatus?: AgentStatusEntry | null
  backgroundTaskReport?: ActiveTabBackgroundTaskReport
  hostBackgroundTasks?: AgentSessionBackgroundTaskState | null
}): BackgroundTask[] {
  const { messages, agentStatus, backgroundTaskReport, hostBackgroundTasks } = input
  // Observed here as well as in the sheet, so a subagent's run start is
  // caught while the sheet is closed (use-subagent-run-clock.ts).
  useSubagentRunClock(agentStatus)
  return useMemo(
    () => runningTasksNow(messages, agentStatus, backgroundTaskReport, hostBackgroundTasks),
    [agentStatus, backgroundTaskReport, hostBackgroundTasks, messages]
  )
}

function runningTasksNow(
  messages: readonly NativeChatMessage[],
  agentStatus: AgentStatusEntry | null | undefined,
  backgroundTaskReport: ActiveTabBackgroundTaskReport | undefined,
  hostBackgroundTasks: AgentSessionBackgroundTaskState | null | undefined
): BackgroundTask[] {
  const now = Date.now()
  // The host's roster answers when it has one — including when its answer is
  // zero, which is why this is not a `||` fallthrough.
  const structured = projectStructuredBackgroundTasks(hostBackgroundTasks, now)
  if (structured) {
    return structured.running
  }
  return deriveBackgroundTasks(messages, now, agentStatus ?? null, {
    finishedTaskIds: backgroundTaskReport?.finishedTaskIds ?? [],
    runningTaskIds: backgroundTaskReport?.runningTaskIds ?? null,
    runningTaskIdsAt: backgroundTaskReport?.runningTaskIdsAt ?? null,
    launchedTaskIds: backgroundTaskReport?.launchedTaskIds ?? [],
    onScreenShellCount: backgroundTaskReport?.onScreenShellCount ?? null,
    screenCompletions: backgroundTaskReport?.screenCompletions ?? []
  }).running
}
