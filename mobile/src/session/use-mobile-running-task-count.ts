import { useMemo } from 'react'
import type { AgentSessionBackgroundTaskState } from '../../../src/shared/agent-session-wire'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { countRunningBackgroundTasks, withoutAgentTasks } from './mobile-background-tasks'
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
  return useMemo(() => {
    // The host's roster answers when it has one — including when its answer is
    // zero, which is why this is not a `||` fallthrough. Subagents are dropped
    // from both branches so this number matches the sheet's list.
    const structured = projectStructuredBackgroundTasks(hostBackgroundTasks, 0)
    if (structured) {
      return withoutAgentTasks(structured).running.length
    }
    return countRunningBackgroundTasks(messages, agentStatus ?? null, {
      finishedTaskIds: backgroundTaskReport?.finishedTaskIds ?? [],
      runningTaskIds: backgroundTaskReport?.runningTaskIds ?? null,
      runningTaskIdsAt: backgroundTaskReport?.runningTaskIdsAt ?? null,
      launchedTaskIds: backgroundTaskReport?.launchedTaskIds ?? [],
      onScreenShellCount: backgroundTaskReport?.onScreenShellCount ?? null
    })
  }, [agentStatus, backgroundTaskReport, hostBackgroundTasks, messages])
}
