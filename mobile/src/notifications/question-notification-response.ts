import {
  nativeChatAskDismissKey,
  type AskAnswerSelection,
  type AskPrompt
} from '../../../src/shared/native-chat-ask'
import type { RpcClient } from '../transport/rpc-client'
import type { PendingPrompt } from './permission-lookup'
import type { PromptAnswerOutcome } from './permission-notification-response'
import { QUESTION_ANSWER_ACTION, QUESTION_OTHER_ACTION } from './question-notification-content'
import { parseQuestionReply, type QuestionReplyMode } from './question-reply-parse'

/** What a question notification carries so its buttons can be answered. */
export type QuestionNotificationData = {
  hostId: string
  worktreeId: string
  /** Identity of the prompt the banner was BUILT from: the whole canonical
   *  prompt (`nativeChatAskDismissKey`), not a digest of it. */
  questionKey: string
  /** Action identifier to the option index that button picks. Empty when the
   *  only action is a reply field. */
  picks: Record<string, number>
}

/** What the sender is handed: the LIVE prompt the keystrokes are built from,
 *  never the one the banner remembered, and the selections the card would
 *  have built for the same answer. */
export type QuestionAnswerSend = {
  /** For the sender's log line: a refused write has to say which host. */
  hostId: string
  client: RpcClient
  terminal: string
  agent: string
  prompt: AskPrompt
  selections: AskAnswerSelection[]
}

/** How the tap says what to write: a button's pick, or a reply field's text. */
type Answer = { kind: 'pick'; optionIndex: number } | { kind: 'reply'; mode: QuestionReplyMode }

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

function answerFor(actionIdentifier: string, data: QuestionNotificationData): Answer | null {
  if (actionIdentifier === QUESTION_OTHER_ACTION) {
    return { kind: 'reply', mode: 'other' }
  }
  if (actionIdentifier === QUESTION_ANSWER_ACTION) {
    return { kind: 'reply', mode: 'answer' }
  }
  const optionIndex = data.picks[actionIdentifier]
  return optionIndex === undefined ? null : { kind: 'pick', optionIndex }
}

/** A refusal leaves one line behind, because the shade shows the user nothing
 *  and the banner simply stays up. Host and terminal say where to look. */
function refuse(detail: { hostId: string; terminal: string; reason: string }): 'refused' {
  console.warn('[question-notification] reply refused', detail)
  return 'refused'
}

/**
 * The selections the card would have built for this answer, against the LIVE
 * prompt: a button is its option, a reply is whatever the parser makes of the
 * text. Null with a reason when nothing should be written.
 */
function selectionsFor(
  answer: Answer,
  userText: string | null,
  prompt: AskPrompt
): { ok: true; selections: AskAnswerSelection[] } | { ok: false; reason: string } {
  switch (answer.kind) {
    case 'pick': {
      // The key already says the live prompt is the one the banner was built
      // from; this says the pick is a choice it actually has. A banner never
      // offers one it does not, so only a hand-made payload gets this far.
      const question = prompt.questions[0]
      if (
        prompt.questions.length !== 1 ||
        !question ||
        question.multiSelect ||
        question.options[answer.optionIndex] === undefined
      ) {
        return { ok: false, reason: `pick ${answer.optionIndex} is not one of the live options` }
      }
      return { ok: true, selections: [{ indices: [answer.optionIndex] }] }
    }
    case 'reply':
      if (userText === null) {
        return { ok: false, reason: 'reply field returned no text' }
      }
      return parseQuestionReply(prompt, userText, answer.mode)
    default: {
      const exhaustive: never = answer
      return exhaustive
    }
  }
}

/**
 * Answer a question from its notification action: a choice button, or a reply
 * typed into the shade.
 *
 * The re-check is the whole point, and it is not optional — for the same reason
 * it is not for a permission. A notification sits in the shade until it is
 * dismissed: by the time a thumb reaches a choice the agent may have been
 * answered at the desk, timed out, or gone on to ask something else with
 * different choices in the same slots. Sending a stored digit blind would pick
 * whatever is in that slot NOW, and a reply typed against the old question
 * would answer the new one with the old words.
 *
 * So the prompt is looked up again and compared by `nativeChatAskDismissKey`,
 * which is the whole canonical prompt: text, headers and every option label. A
 * mismatch sends nothing. Only then is the answer read — a button's pick, or
 * the reply text parsed against the LIVE prompt — and the keystrokes are built
 * from that prompt, by the sender, with the same builder the chat card uses.
 *
 * Never throws: this runs from a notification response handler, sometimes in a
 * headless context where a rejection reaches nobody.
 */
export async function answerQuestionFromNotification(args: {
  actionIdentifier: string
  /** What the user typed into a reply field; null for a plain button. */
  userText: string | null
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
    const answer = answerFor(args.actionIdentifier, data)
    // Android delivers the DEFAULT identifier when the body is tapped rather
    // than a button. That is "open the app", not "answer", and must not send.
    if (!answer) {
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
    const read = selectionsFor(answer, args.userText, pending.prompt)
    if (!read.ok) {
      return refuse({ hostId: data.hostId, terminal: pending.terminal, reason: read.reason })
    }
    const sent = await args.send({
      hostId: data.hostId,
      client,
      terminal: pending.terminal,
      agent: pending.agent,
      prompt: pending.prompt,
      selections: read.selections
    })
    return sent ? 'sent' : 'failed'
  } catch {
    return 'failed'
  }
}
