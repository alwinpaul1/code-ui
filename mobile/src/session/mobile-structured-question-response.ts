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
