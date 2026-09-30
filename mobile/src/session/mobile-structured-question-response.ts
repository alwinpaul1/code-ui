import type { AgentSessionQuestionAnswer } from '../../../src/shared/agent-session-question-answer'

/**
 * The longest `optionId` the host accepts on `agentSession.respondToQuestion`
 * (`MAX_RESPONSE_OPTION_ID_LENGTH` in the vendored structured-agent-session-params.ts, which the
 * phone imports as a type only, so the number is repeated here and a test holds the two together).
 */
export const RESPOND_TO_QUESTION_OPTION_ID_MAX_LENGTH = 1024

/**
 * The fields of one `agentSession.respondToQuestion` call. The host takes exactly one of `optionId`
 * and `answers`. A typed answer is packed into `optionId` by default, the one form every host reads;
 * a long one overflows that field, so from Orca 1.4.217 (#22793) it goes as structured `answers`
 * instead. A host older than that refuses the field, which is the failure the packed form gave for
 * the same answer, so nothing that worked before stops working.
 */
export function structuredQuestionResponseFields(target: {
  itemId: string
  expectedRevision: number
  optionId: string
  answers?: AgentSessionQuestionAnswer[]
}): {
  itemId: string
  expectedRevision: number
} & ({ optionId: string } | { answers: AgentSessionQuestionAnswer[] }) {
  const { itemId, expectedRevision, optionId, answers } = target
  return answers && optionId.length > RESPOND_TO_QUESTION_OPTION_ID_MAX_LENGTH
    ? { itemId, expectedRevision, answers }
    : { itemId, expectedRevision, optionId }
}

/**
 * What the phone says when a host refuses a call carrying `answers` at the schema. Two hosts do:
 * one older than Orca 1.4.217 has a strict `respondToQuestion` that knows only `optionId`, and
 * answers with raw zod text that names nothing ("Invalid input: expected string, received
 * undefined"); a 1.4.217 host takes the field but caps one answer at 64 KiB ("Too big: expected
 * string to have <=65536 characters", or "Answer is too large" past the byte cap). The wording
 * follows the refusal's cause, not the assumption that the host is old.
 */
export const ANSWER_TOO_LONG_FOR_HOST =
  "This answer is too long for this desktop's Orca. Update Orca to 1.4.217 or shorten the answer."
export const ANSWER_TOO_LONG = 'This answer is too long. Shorten it and send it again.'
const HOST_SAYS_TOO_BIG = /too (?:big|large|long)|expected string to have <=\s*\d+/i

export function explainLongAnswerFailure(failure: {
  code: string | null
  message: string
}): string {
  if (failure.code !== 'invalid_argument') {
    return failure.message
  }
  return HOST_SAYS_TOO_BIG.test(failure.message) ? ANSWER_TOO_LONG : ANSWER_TOO_LONG_FOR_HOST
}
