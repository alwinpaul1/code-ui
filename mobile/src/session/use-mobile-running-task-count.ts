import { useMemo } from 'react'
import type { AgentSessionBackgroundTaskState } from '../../../src/shared/agent-session-wire'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { countRunningBackgroundTasks } from './mobile-background-tasks'
import { projectStructuredBackgroundTasks } from './mobile-structured-background-tasks'
import type { ActiveTabBackgroundTaskReport } from './use-active-tab-finished-task-ids'

/** How many background tasks the tab has in flight, from the host's roster
 *  when it has one and the transcript plus beacons otherwise. Shared by the
 *  row under the last message and the status line above the composer, which
 *  must never disagree. */
export function useMobileRunningTaskCount(input: {
  messages: readonly NativeChatMessage[]
  agentStatus?: AgentStatusEntry | null
  backgroundTaskReport?: ActiveTabBackgroundTaskReport
  hostBackgroundTasks?: AgentSessionBackgroundTaskState | null
}): number {
  const { messages, agentStatus, backgroundTaskReport, hostBackgroundTasks } = input
  return useMemo(
    () =>
      projectStructuredBackgroundTasks(hostBackgroundTasks, 0)?.running.length ??
      countRunningBackgroundTasks(messages, agentStatus ?? null, {
        finishedTaskIds: backgroundTaskReport?.finishedTaskIds ?? [],
        runningTaskIds: backgroundTaskReport?.runningTaskIds ?? null,
        runningTaskIdsAt: backgroundTaskReport?.runningTaskIdsAt ?? null,
        launchedTaskIds: backgroundTaskReport?.launchedTaskIds ?? []
      }),
    [agentStatus, backgroundTaskReport, hostBackgroundTasks, messages]
  )
}
