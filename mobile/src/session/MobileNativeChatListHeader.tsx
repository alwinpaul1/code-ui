import { useMemo } from 'react'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { MobileChatQueueEntry } from './mobile-terminal-queued-messages'
import type { AgentSessionBackgroundTaskState } from '../../../src/shared/agent-session-wire'
import { countRunningBackgroundTasks } from './mobile-background-tasks'
import { projectStructuredBackgroundTasks } from './mobile-structured-background-tasks'
import { MobileBackgroundTasksRow } from './MobileBackgroundTasksRow'
import { MobileNativeChatQueue } from './MobileNativeChatQueue'
import { MobileNativeChatTurnStatus } from './MobileNativeChatTurnStatus'
import type { NativeChatTurnActivity } from './mobile-native-chat-turn-activity'
import type { NativeChatTurnStatus } from './use-mobile-native-chat-turn-status'
import type { ActiveTabBackgroundTaskReport } from './use-active-tab-finished-task-ids'

/** Everything that paints below the newest bubble. The transcript list is
 *  inverted, so its "header" is the bottom of the conversation: the live turn's
 *  status when no user message can carry it, the running background tasks, and
 *  the queue waiting behind the current turn. */
export function MobileNativeChatListHeader({
  messages,
  agent,
  agentStatus,
  backgroundTaskReport,
  hostBackgroundTasks,
  queuedMessages,
  onEditQueue,
  unanchoredTurnStatus,
  turnActivity,
  onOpenBackgroundTasks
}: {
  /** The UNFILTERED transcript on purpose: the `<task-notification>` turns that
   *  retire a task are harness noise, so the folded list drops them. Codex
   *  writes none of these records, so a Codex TERMINAL tab counts zero and
   *  shows no row; a structured tab reads `hostBackgroundTasks` instead and
   *  never looks at this list. */
  messages: NativeChatMessage[]
  agent?: string | null
  agentStatus?: AgentStatusEntry | null
  backgroundTaskReport?: ActiveTabBackgroundTaskReport
  /** The structured lane's own roster from the host. Authoritative when the
   *  host has reported one — including when it has cleared it to `null`. */
  hostBackgroundTasks?: AgentSessionBackgroundTaskState | null
  queuedMessages?: readonly MobileChatQueueEntry[]
  onEditQueue?: (index: number, tapped: string) => Promise<void>
  /** Set only while the live turn has no user message to hang its status under. */
  unanchoredTurnStatus?: NativeChatTurnStatus | null
  turnActivity?: NativeChatTurnActivity | null
  onOpenBackgroundTasks: () => void
}) {
  // `now` is 0 because only the sheet draws an elapsed clock; which tasks are
  // running does not depend on it.
  const runningTaskCount = useMemo(
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
  return (
    <>
      {unanchoredTurnStatus ? (
        <MobileNativeChatTurnStatus
          startedAt={unanchoredTurnStatus.startedAt}
          thinking={unanchoredTurnStatus.thinking}
          workedSeconds={unanchoredTurnStatus.workedSeconds}
          activityText={turnActivity?.text}
        />
      ) : null}
      <MobileBackgroundTasksRow runningCount={runningTaskCount} onPress={onOpenBackgroundTasks} />
      <MobileNativeChatQueue messages={queuedMessages} agent={agent} onEdit={onEditQueue} />
    </>
  )
}
