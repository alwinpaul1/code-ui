import { nativeChatAskDismissKey, type AskPrompt } from '../../../src/shared/native-chat-ask'
import type { RpcClient } from '../transport/rpc-client'
import type { PendingPrompt } from './permission-lookup'
import type { PromptAnswerOutcome } from './permission-notification-response'
import { QUESTION_ANSWER_ACTION } from './question-notification-content'

/** What a question notification carries so its buttons can be answered. */
export type QuestionNotificationData = {
  hostId: string
  worktreeId: string
  /** Identity of the prompt the banner was BUILT from: the whole canonical
   *  prompt (`nativeChatAskDismissKey`), not a digest of it. */
  questionKey: string
  /** Action identifier to the option index that button picks. Empty when the
   *  only button is the Answer route. */
  picks: Record<string, number>
}

/** What the sender is handed for a pick: the LIVE prompt the keystrokes are
 *  built from, never the one the banner remembered. */
export type QuestionAnswerSend = {
  /** For the sender's log line: a refused write has to say which host. */
  hostId: string
  client: RpcClient
  terminal: string
  agent: string
  prompt: AskPrompt
  optionIndex: number
}

function readData(value: unknown): QuestionNotificationData | null {
  if (value == null || typeof value !== 'object') {
    return null
  }
  const box = Object(value)
  const hostId: unknown = Reflect.get(box, 'hostId')
  const worktreeId: unknown = Reflect.get(box, 'worktreeId')
  const questionKey: unknown = Reflect.get(box, 'questionKey')
  const rawPicks: unknown = Reflect.get(box, 'picks')
  if (
    typeof hostId !== 'string' ||
    typeof worktreeId !== 'string' ||
    typeof questionKey !== 'string' ||
    rawPicks == null ||
    typeof rawPicks !== 'object'
  ) {
    return null
  }
  const picks: Record<string, number> = {}
  for (const [identifier, index] of Object.entries(Object(rawPicks))) {
    if (typeof index === 'number' && Number.isInteger(index) && index >= 0) {
      picks[identifier] = index
    }
  }
  return { hostId, worktreeId, questionKey, picks }
}

/**
 * Answer a question from its notification action.
 *
 * The re-check is the whole point, and it is not optional — for the same reason
 * it is not for a permission. A notification sits in the shade until it is
 * dismissed: by the time a thumb reaches a choice the agent may have been
 * answered at the desk, timed out, or gone on to ask something else with
 * different choices in the same slots. Sending a stored digit blind would pick
 * whatever is in that slot NOW.
 *
 * So the prompt is looked up again and compared by `nativeChatAskDismissKey`,
 * which is the whole canonical prompt: text, headers and every option label. A
 * mismatch sends nothing. The keystrokes are then built from the LIVE prompt,
 * by the sender, with the same builder the chat card uses.
 *
 * The Answer button is the other route: it opens the app on the session, and
 * touches nothing here.
 *
 * Never throws: this runs from a notification response handler, sometimes in a
 * headless context where a rejection reaches nobody.
 */
export async function answerQuestionFromNotification(args: {
  actionIdentifier: string
  data: unknown
  resolveClient: (hostId: string) => RpcClient | null
  lookup: (client: RpcClient, worktreeId: string) => Promise<PendingPrompt | null>
  send: (input: QuestionAnswerSend) => Promise<boolean>
}): Promise<PromptAnswerOutcome> {
  try {
    const data = readData(args.data)
    if (!data) {
      return 'not-an-answer'
    }
    if (args.actionIdentifier === QUESTION_ANSWER_ACTION) {
      return 'open-app'
    }
    const optionIndex = data.picks[args.actionIdentifier]
    // Android delivers the DEFAULT identifier when the body is tapped rather
    // than a button. That is "open the app", not "answer", and must not send.
    if (optionIndex === undefined) {
      return 'not-an-answer'
    }
    const client = args.resolveClient(data.hostId)
    if (!client) {
      return 'unroutable'
    }
    if (client.getState() !== 'connected') {
      return 'offline'
    }
    const pending = await args.lookup(client, data.worktreeId)
    if (
      !pending ||
      pending.kind !== 'question' ||
      nativeChatAskDismissKey(pending.prompt) !== data.questionKey
    ) {
      return 'stale'
    }
    // The key already says the live prompt is the one the banner was built
    // from; this says the pick is a choice it actually has. A banner never
    // offers one it does not, so only a hand-made payload gets this far.
    const question = pending.prompt.questions[0]
    if (
      pending.prompt.questions.length !== 1 ||
      !question ||
      question.multiSelect ||
      question.options[optionIndex] === undefined
    ) {
      return 'stale'
    }
    const sent = await args.send({
      hostId: data.hostId,
      client,
      terminal: pending.terminal,
      agent: pending.agent,
      prompt: pending.prompt,
      optionIndex
    })
    return sent ? 'sent' : 'failed'
  } catch {
    return 'failed'
  }
}
