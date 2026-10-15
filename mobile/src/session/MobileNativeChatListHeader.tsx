import type { MobileChatQueueEntry } from './mobile-terminal-queued-messages'
import { MobileNativeChatQueue } from './MobileNativeChatQueue'
import { MobileNativeChatLocalQueue } from './MobileNativeChatLocalQueue'
import { MobileNativeChatTurnStatus } from './MobileNativeChatTurnStatus'
import type { NativeChatTurnActivity } from './mobile-native-chat-turn-activity'
import type { NativeChatTurnStatus } from './use-mobile-native-chat-turn-status'

/** Everything that paints below the newest bubble. The transcript list is
 *  inverted, so its "header" is the bottom of the conversation: the live turn's
 *  status when no user message can carry it, and the queue waiting behind the
 *  current turn. The running-tasks count moved to the status line above the
 *  composer, where the Claude app draws it (2026-09-24). */
export function MobileNativeChatListHeader({
  agent,
  queuedMessages,
  onEditQueue,
  onSendQueueNow,
  agentWorking = false,
  localQueue,
  unanchoredTurnStatus,
  turnActivity
}: {
  agent?: string | null
  queuedMessages?: readonly MobileChatQueueEntry[]
  onEditQueue?: (index: number, tapped: string) => Promise<void>
  onSendQueueNow?: () => Promise<boolean>
  agentWorking?: boolean
  /** A tab that sends through Anthropic keeps its queue on the phone (use-ccr-composer-send.ts)
   *  and draws it as the Claude app does, in place of the agent's screen-read queue box. */
  localQueue?: { text: string | null; onEdit: () => void } | null
  /** Set only while the live turn has no user message to hang its status under. */
  unanchoredTurnStatus?: NativeChatTurnStatus | null
  turnActivity?: NativeChatTurnActivity | null
}) {
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
      {localQueue ? (
        <MobileNativeChatLocalQueue text={localQueue.text} onEdit={localQueue.onEdit} />
      ) : (
        <MobileNativeChatQueue
          messages={queuedMessages}
          agent={agent}
          onEdit={onEditQueue}
          onSendNow={onSendQueueNow}
          agentWorking={agentWorking}
        />
      )}
    </>
  )
}
