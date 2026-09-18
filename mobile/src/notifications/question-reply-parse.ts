import type { AskAnswerSelection, AskPrompt, AskQuestion } from '../../../src/shared/native-chat-ask'

export type QuestionReplyParse =
  | { ok: true; selections: AskAnswerSelection[] }
  /** Nothing to write. `reason` is for the log line, in plain words. */
  | { ok: false; reason: string }

/** Which reply field the text came from. "Other…" sits beside option buttons
 *  and is always free text, even when it holds a digit; "Answer" stands alone
 *  and takes option numbers or text. */
export type QuestionReplyMode = 'other' | 'answer'

/** "2", "1,3", " 1 , 3 " — and nothing else. A sentence that starts with a
 *  number is a sentence. */
const NUMBERS_ONLY = /^\s*\d+(\s*,\s*\d+)*\s*$/

function answerOne(
  question: AskQuestion,
  text: string,
  mode: QuestionReplyMode,
  label: string
): { ok: true; selection: AskAnswerSelection } | { ok: false; reason: string } {
  const trimmed = text.trim()
  // Nothing, or only punctuation (a stray "," or ";"), is not an answer worth
  // typing into the agent.
  if (!/[\p{L}\p{N}]/u.test(trimmed)) {
    return { ok: false, reason: `${label}: empty answer` }
  }
  if (mode === 'other' || !NUMBERS_ONLY.test(trimmed)) {
    // The card draws an "Other…" row under every question, for every agent it
    // can drive, and sends it as an empty pick with the text. Same here.
    return { ok: true, selection: { indices: [], other: trimmed } }
  }
  const count = question.options.length
  if (count === 0) {
    return { ok: false, reason: `${label}: has no numbered options` }
  }
  const numbers = trimmed.split(',').map((part) => Number.parseInt(part, 10))
  for (const number of numbers) {
    if (!Number.isInteger(number) || number < 1 || number > count) {
      return { ok: false, reason: `${label}: option ${number} is not one of 1–${count}` }
    }
  }
  // Each digit TOGGLES a checkbox in a multi-select, so a repeat would undo
  // itself. Once is what was meant.
  const indices = [...new Set(numbers.map((number) => number - 1))]
  if (!question.multiSelect && indices.length > 1) {
    return { ok: false, reason: `${label}: takes one choice, got ${indices.length}` }
  }
  return { ok: true, selection: { indices } }
}

/**
 * What a reply typed into the shade means, against the prompt that is pending
 * NOW.
 *
 * One question: the whole text is its answer. Several: one answer per
 * question, in order, separated by semicolons — and exactly one per
 * question, because a semicolon inside a free-text answer would shift every
 * answer after it onto the wrong question, and there is no way to tell which
 * semicolon was meant. Refusing there is cheaper than a wrong pick.
 *
 * Numbers are the option numbers the agent's own selector shows (1-based), so
 * they can be written as the digits the selector commits on. Anything else is
 * the free-text answer.
 */
export function parseQuestionReply(
  prompt: AskPrompt,
  text: string,
  mode: QuestionReplyMode
): QuestionReplyParse {
  const questions = prompt.questions
  const parts = questions.length > 1 ? text.split(';') : [text]
  if (parts.length !== questions.length) {
    return {
      ok: false,
      reason: `${parts.length} answer${parts.length === 1 ? '' : 's'} for ${questions.length} questions (separate them with ;)`
    }
  }
  const selections: AskAnswerSelection[] = []
  for (let index = 0; index < questions.length; index += 1) {
    const label = questions.length > 1 ? `question ${index + 1}` : 'answer'
    const one = answerOne(questions[index]!, parts[index]!, mode, label)
    if (!one.ok) {
      return one
    }
    selections.push(one.selection)
  }
  return { ok: true, selections }
}
