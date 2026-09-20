import { useMemo } from 'react'
import type { AgentSessionBackgroundTaskState } from '../../../src/shared/agent-session-wire'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { countRunningBackgroundTasks } from './mobile-background-tasks'
import { projectStructuredBackgroundTasks } from './mobile-structured-background-tasks'
import { useSubagentRunClock } from './use-subagent-run-clock'
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
  // Observed here as well as in the sheet, so a subagent's run start is
  // caught while the sheet is closed (use-subagent-run-clock.ts).
  useSubagentRunClock(agentStatus)
  return useMemo(() => {
    // The host's roster answers when it has one — including when its answer is
    // zero, which is why this is not a `||` fallthrough.
    const structured = projectStructuredBackgroundTasks(hostBackgroundTasks, 0)
    if (structured) {
      return structured.running.length
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
