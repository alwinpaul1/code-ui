import { useMemo } from 'react'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { MobileChatQueueEntry } from './mobile-terminal-queued-messages'
import { countRunningBackgroundTasks } from './mobile-background-tasks'
import { MobileBackgroundTasksRow } from './MobileBackgroundTasksRow'
import { MobileNativeChatQueue } from './MobileNativeChatQueue'
import { MobileNativeChatTurnStatus } from './MobileNativeChatTurnStatus'
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
  queuedMessages,
  onEditQueue,
  unanchoredTurnStatus,
  onOpenBackgroundTasks
}: {
  /** The UNFILTERED transcript on purpose: the `<task-notification>` turns that
   *  retire a task are harness noise, so the folded list drops them. Codex
   *  writes none of these records, so its tabs count zero and show no row. */
  messages: NativeChatMessage[]
  agent?: string | null
  agentStatus?: AgentStatusEntry | null
  backgroundTaskReport?: ActiveTabBackgroundTaskReport
  queuedMessages?: readonly MobileChatQueueEntry[]
  onEditQueue?: (index: number, tapped: string) => Promise<void>
  /** Set only while the live turn has no user message to hang its status under. */
  unanchoredTurnStatus?: NativeChatTurnStatus | null
  onOpenBackgroundTasks: () => void
}) {
  const runningTaskCount = useMemo(
    () =>
      countRunningBackgroundTasks(messages, agentStatus ?? null, {
        finishedTaskIds: backgroundTaskReport?.finishedTaskIds ?? [],
        runningTaskIds: backgroundTaskReport?.runningTaskIds ?? null
      }),
    [agentStatus, backgroundTaskReport, messages]
  )
  return (
    <>
      {unanchoredTurnStatus ? (
        <MobileNativeChatTurnStatus
          startedAt={unanchoredTurnStatus.startedAt}
          thinking={unanchoredTurnStatus.thinking}
          workedSeconds={unanchoredTurnStatus.workedSeconds}
        />
      ) : null}
      <MobileBackgroundTasksRow runningCount={runningTaskCount} onPress={onOpenBackgroundTasks} />
      <MobileNativeChatQueue messages={queuedMessages} agent={agent} onEdit={onEditQueue} />
    </>
  )
}
