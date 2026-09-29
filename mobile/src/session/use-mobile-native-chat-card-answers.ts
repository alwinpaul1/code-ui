import { useCallback } from 'react'
import { useAnsweredPromptNoticeHold } from './use-answered-prompt-notice-hold'
import { useNativeChatAcceptedAction } from './use-native-chat-action-outcomes'

type CardAnswer<Params extends unknown[]> = (...params: Params) => Promise<boolean>

/**
 * What the chat's prompt cards do once the host accepts an answer: retire the
 * route's held failure banner, as a send does, and hold the waiting notice
 * until the answered card leaves (use-answered-prompt-notice-hold.ts: the
 * dialog the screen showed is the one answered). The legacy question card only
 * holds the notice; it never held the banner.
 *
 * Moved out of use-mobile-native-chat-controller.ts as it stood after the
 * question-card fix (4f6110f7), unchanged, to keep that file within its line cap.
 */
export function useMobileNativeChatCardAnswers<
  AskParams extends unknown[],
  CancelParams extends unknown[],
  QuestionParams extends unknown[],
  PermissionParams extends unknown[]
>(args: {
  /** The card that stands for the prompt now: terminalPromptWait's `card`. */
  card: unknown
  /** The screen poll's own flag: its dialog reading predates its last re-read. */
  dialogBeforeAnswer: boolean
  rereadAfterAnswer: () => void
  onSendResolved: () => void
  answers: {
    ask: CardAnswer<AskParams>
    cancelAsk: CardAnswer<CancelParams>
    question: CardAnswer<QuestionParams>
    permission: CardAnswer<PermissionParams>
  }
}): {
  /** For terminalPromptWait: the screen's dialog may not raise the notice. */
  noticeHeld: boolean
  onCardAnswered: () => void
  answerAsk: CardAnswer<AskParams>
  cancelAsk: CardAnswer<CancelParams>
  answerQuestion: CardAnswer<QuestionParams>
  respond: CardAnswer<PermissionParams>
} {
  const { card, dialogBeforeAnswer, rereadAfterAnswer, onSendResolved, answers } = args
  const { answered: noteAnswered, dialogBeforeAnswer: noticeHeld } = useAnsweredPromptNoticeHold({ card, dialogBeforeAnswer, rereadAfterAnswer })
  const onCardAnswered = useCallback(() => { onSendResolved(); noteAnswered() }, [onSendResolved, noteAnswered])
  const answerAsk = useNativeChatAcceptedAction(answers.ask, onCardAnswered)
  const cancelAsk = useNativeChatAcceptedAction(answers.cancelAsk, onCardAnswered)
  const answerQuestion = useNativeChatAcceptedAction(answers.question, noteAnswered)
  const respond = useNativeChatAcceptedAction(answers.permission, onCardAnswered)
  return { noticeHeld, onCardAnswered, answerAsk, cancelAsk, answerQuestion, respond }
}
