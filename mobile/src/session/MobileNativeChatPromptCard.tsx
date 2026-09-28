import type { AskAnswerSelection, AskPrompt } from '../../../src/shared/native-chat-ask'
import { MobileNativeChatAsk } from './MobileNativeChatAsk'
import { MobileNativeChatPermission } from './MobileNativeChatPermission'
import type { MobileChatPermission } from './mobile-native-chat-permission'
import { MobileNativeChatQuestion } from './MobileNativeChatQuestion'
import { MobileNativeChatTerminalWait } from './MobileNativeChatTerminalWait'
import type { NativeChatTerminalWait } from './mobile-terminal-permission-options-merge'
import { mobileChatPermissionKey } from './mobile-native-chat-permission'
import { mobileChatQuestionKey, type MobileChatQuestion } from './mobile-native-chat-question'
import type { AskDismissOutcome } from './use-mobile-native-chat-ask-dismiss'

export type MobileNativeChatPromptCardProps = {
  ask?: AskPrompt | null
  askKey?: string | null
  /** When this phone's answer to `ask` was accepted; the card shows it sent. */
  askSentAt?: number | null
  onDismissAsk?: (outcome?: AskDismissOutcome) => void
  onAnswerAsk?: (prompt: AskPrompt, selections: AskAnswerSelection[]) => Promise<boolean>
  onCancelAsk?: () => Promise<boolean>
  /** Cancels a structured approval/question by its item identity (Orca #20601). */
  onCancelPrompt?: (prompt?: NonNullable<MobileChatPermission['prompt']>) => Promise<boolean>
  question?: MobileChatQuestion | null
  onAnswerQuestion?: (text: string) => Promise<boolean>
  permission?: MobileChatPermission | null
  onRespondPermission?: (send: string) => Promise<boolean>
  onRespondPermissionWithComment?: (send: string, comment: string) => Promise<boolean>
  /** The agent waits on a prompt none of the cards above can show. */
  terminalWait?: NativeChatTerminalWait | null
  onOpenTerminal?: () => void
}

/** The pending agent prompt above the composer: a structured AskUserQuestion
 *  wins, then a heuristic permission, then a heuristic question, and with none
 *  of them, a notice that the agent waits in the terminal. The controller
 *  owns dismissal (it must survive this subtree unmounting on a view toggle);
 *  `ask` arrives already nulled while dismissed. An accepted answer is recorded
 *  as answered, not dismissed: the card stays up as sent until the agent's
 *  hook row lets go of the question (use-mobile-native-chat-ask-dismiss.ts). */
export function MobileNativeChatPromptCard({
  ask,
  askKey,
  askSentAt,
  onDismissAsk,
  onAnswerAsk,
  onCancelAsk,
  onCancelPrompt,
  question,
  onAnswerQuestion,
  permission,
  onRespondPermission,
  onRespondPermissionWithComment,
  terminalWait,
  onOpenTerminal
}: MobileNativeChatPromptCardProps) {
  // An answered question waiting for its hook row to let go is only news; an
  // approval raised meanwhile (a Codex child's, whose rows keep the lead's
  // question on the row) is something to act on, so it takes the dock.
  if (ask && !(askSentAt != null && permission)) {
    return (
      <MobileNativeChatAsk
        key={askKey ?? 'ask'}
        prompt={ask}
        sentAt={askSentAt ?? null}
        onAnswer={async (selections) => {
          const accepted = (await onAnswerAsk?.(ask, selections)) ?? false
          if (accepted) {
            onDismissAsk?.('answered')
          }
          return accepted
        }}
        onCancel={async () => {
          const accepted = (await onCancelAsk?.()) ?? false
          if (accepted) {
            onDismissAsk?.()
          }
          return accepted
        }}
      />
    )
  }
  if (permission) {
    return (
      <MobileNativeChatPermission
        key={mobileChatPermissionKey(permission)}
        permission={permission}
        onRespond={async (send) => (await onRespondPermission?.(send)) ?? false}
        onRespondWithComment={
          onRespondPermissionWithComment
            ? async (send, comment) =>
                (await onRespondPermissionWithComment(send, comment)) ?? false
            : undefined
        }
        onCancel={onCancelPrompt}
      />
    )
  }
  if (question) {
    return (
      <MobileNativeChatQuestion
        key={mobileChatQuestionKey(question)}
        question={question}
        onAnswer={async (text) => (await onAnswerQuestion?.(text)) ?? false}
        onCancel={onCancelPrompt}
      />
    )
  }
  if (terminalWait) {
    return <MobileNativeChatTerminalWait wait={terminalWait} onOpenTerminal={onOpenTerminal} />
  }
  return null
}
