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
  /** Declining the ask is refused, with a reason on the card: the question is
   *  the transcript's copy alone while the agent works, so an Escape would
   *  interrupt the turn. Nor is the card dismissed: the transcript can run ahead
   *  of the hook row, and a dismissal keyed on the question would keep the card
   *  hidden once the row flips to waiting on it. */
  askDeclineHeld?: boolean
  /** The chat view's keyboard inset, for the ask card's height cap. */
  keyboardInset?: number
  /** The composer is drawn under the ask card (askTakesComposerPlace false). */
  askBesideComposer?: boolean
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

/** Why Skip declined nothing (MobileNativeChatPromptCardProps.askDeclineHeld). */
export const ASK_DECLINE_HELD_NOTE = 'Not declined: the agent is working. Stop it first.'

/** Like the Claude app, a question card takes the composer's place (2026-10-16),
 *  but only while the agent is confirmed waiting on it (`askLive`). The
 *  transcript's copy alone can be stale, and hiding the composer under it took
 *  Stop from a working agent. A sent answer gives it back, and so does dictation:
 *  the recording row lives in the composer and is the mic's only control. */
export function askTakesComposerPlace(args: {
  ask: AskPrompt | null | undefined
  askLive: boolean
  askSentAt: number | null | undefined
  micActive: boolean | undefined
  micTranscribing: boolean | undefined
}): boolean {
  const { ask, askLive, askSentAt, micActive, micTranscribing } = args
  return ask != null && askLive && askSentAt == null && micActive !== true && micTranscribing !== true
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
  askDeclineHeld = false,
  keyboardInset = 0,
  askBesideComposer = false,
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
        keyboardInset={keyboardInset} besideComposer={askBesideComposer}
        declineRefusal={askDeclineHeld ? ASK_DECLINE_HELD_NOTE : null}
        onAnswer={async (selections) => {
          const accepted = (await onAnswerAsk?.(ask, selections)) ?? false
          if (accepted) {
            onDismissAsk?.('answered')
          }
          return accepted
        }}
        onCancel={async () => {
          if (askDeclineHeld) {
            return false
          }
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
