// Heuristic detection of an agent's "pick an option" prompt from its status /
// assistant text. Agents (Claude et al.) render these as a TUI choice list; we
// have no structured signal, so we parse the text conservatively and only treat
// it as a question when a clear option list is present.

import {
  codeFenceStarts,
  collectOptionLists,
  introIndex,
  QUESTION_LINE,
  type OptionList
} from './mobile-native-chat-question-lists'
import { ASKS, asksAfter, asksToChoose } from './mobile-native-chat-question-asks'

export type MobileChatQuestion = {
  question: string
  /** Structured prompt identity, present only for durable host prompts. */
  prompt?: { itemId: string; expectedRevision: number }
  options: string[]
  multiSelect: boolean
  /** Structured questions hide the free-text row when the provider does not accept it. */
  allowOther?: boolean
  /** Per-option leading marker ("1", "b", …) when the source line carried one,
   *  parallel to `options`. Null where the option was a plain bullet. Used to
   *  echo the exact choice the agent listed back to the terminal. */
  optionTokens: (string | null)[]
  /** Per-option secondary text from structured prompts, parallel to `options`. */
  optionDescriptions?: (string | undefined)[]
  /** Opaque prefix used when free-text answers must target a specific prompt. */
  freeTextToken?: string
}

export function mobileChatQuestionKey(question: MobileChatQuestion): string {
  return JSON.stringify(question)
}

const MULTI_SELECT_HINT =
  /\b(select all|choose all|choose multiple|select multiple|pick multiple|all that apply|one or more|comma[- ]separated|multiple options)\b/i

// Drop a trailing ":" off a card title but keep a meaningful "?".
function cleanQuestionText(raw: string): string {
  const trimmed = raw.trim()
  return trimmed.endsWith(':') ? trimmed.slice(0, -1).trim() : trimmed
}

/**
 * Which of the reply's lists holds the choices, or -1 when that is a guess.
 * One list is the choices. With more, the choices are the one list under a
 * line that asks (`?`): a reply often lists findings before it asks and
 * reasons or notes after, and taking the last list sent a finding back as
 * the answer, or dropped the card when notes followed the choices. Two lists
 * under lines that ask, or none, and no card is shown. Nor when a list after
 * the choices lacks a line of its own that introduces it (ends in `:`): with
 * no line between, or only prose the numbering did not bridge, it may be
 * more of the choices.
 */
function choicesListIndex(
  lines: readonly string[],
  lists: readonly OptionList[],
  intros: readonly number[]
): number {
  if (lists.length <= 1) {
    return lists.length - 1
  }
  const asking = intros.flatMap((intro, i) => (intro >= 0 && ASKS.test(lines[intro]) ? [i] : []))
  if (asking.length !== 1) {
    return -1
  }
  const [at] = asking
  const laterIntroduced = intros
    .slice(at + 1)
    .every((intro) => intro >= 0 && QUESTION_LINE.test(lines[intro]))
  return laterIntroduced ? at : -1
}

/**
 * Heuristically parse a question + its option list from agent text. Returns null
 * when no clear option list is present (so ordinary prose is never treated as a
 * question). Conservative on purpose: requires at least two option lines, or one
 * option line introduced by a question-like prompt line.
 *
 * The options are ONE list (choicesListIndex), under the line directly above
 * it, which titles the card. A line that asks after it must ask to choose from
 * it (asksToChoose), or the card is not shown.
 */
export function parseAgentQuestion(text: string): MobileChatQuestion | null {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return null
  }

  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const fenceStarts = codeFenceStarts(lines)
  const lists = collectOptionLists(lines, fenceStarts)
  const intros = lists.map((list, i) => introIndex(lines, list, lists[i - 1] ?? null, fenceStarts))
  const at = choicesListIndex(lines, lists, intros)
  if (at < 0) {
    return null
  }
  const list = lists[at]
  const options = list.items.map((item) => item.label)
  const optionTokens = list.items.map((item) => item.token)
  const question = intros[at] >= 0 ? lines[intros[at]] : ''

  // Conservative gate: a single bare option with no introducing prompt is more
  // likely stray prose (a lone "- item") than a real choice list.
  if (options.length < 2 && !QUESTION_LINE.test(question)) {
    return null
  }
  // "Here's my plan: 1. … 2. … Shall I proceed?" asks for a yes, not a step.
  if (asksAfter(lines, lists, at, fenceStarts).some((ask) => !asksToChoose(ask, list))) {
    return null
  }

  // A hint in the findings above or the notes below says nothing about this
  // list: read the lines from the list before it to the next list's intro.
  const from = at > 0 ? lists[at - 1].end + 1 : 0
  const next = lists[at + 1]
  const to = next ? (intros[at + 1] >= 0 ? intros[at + 1] : next.start) : lines.length
  const scope = lines.slice(from, to).filter((_, i) => fenceStarts[from + i] === -1)
  const multiSelect = MULTI_SELECT_HINT.test(scope.join('\n')) && options.length > 1

  return {
    question: question.length > 0 ? cleanQuestionText(question) : 'Choose an option',
    options,
    multiSelect,
    optionTokens
  }
}

function formatQuestionOptionAtIndex(question: MobileChatQuestion, index: number): string | null {
  if (!Number.isInteger(index) || index < 0 || index >= question.options.length) {
    return null
  }
  const label = question.options[index]
  if (label == null || label.trim().length === 0) {
    return null
  }
  const token = question.optionTokens[index]
  return token != null && token.length > 0 ? token : label
}

function formatQuestionAnswerPartsByIndexes(
  question: MobileChatQuestion,
  selectedIndexes: number[]
): string[] {
  return selectedIndexes
    .map((index) => formatQuestionOptionAtIndex(question, index))
    .filter((part): part is string => part != null && part.trim().length > 0)
}

export function formatQuestionAnswerByIndexes(
  question: MobileChatQuestion,
  selectedIndexes: number[]
): string {
  const parts = formatQuestionAnswerPartsByIndexes(question, selectedIndexes)
  return parts.join(question.multiSelect ? ', ' : ' ')
}

export function formatQuestionAnswerWithOtherByIndexes(
  question: MobileChatQuestion,
  selectedIndexes: number[],
  text: string
): string {
  const parts = formatQuestionAnswerPartsByIndexes(question, selectedIndexes)
  const other = formatQuestionFreeTextAnswer(question, text)
  if (other.length > 0) {
    parts.push(other)
  }
  return parts.join(question.multiSelect ? ', ' : ' ')
}

/**
 * Build the text to send to the agent terminal for the selected option(s).
 * Convention: echo the option's leading marker (number/letter) when the list had
 * one; otherwise send the option label text (TUIs accept the literal choice).
 * Multi-select answers are comma-joined; single-select is sent as-is. Unknown
 * entries (free-text escape hatch) pass through verbatim. Returns '' when
 * nothing is selected.
 */
export function formatQuestionAnswer(question: MobileChatQuestion, selected: string[]): string {
  const labels = selected.map((s) => s.trim()).filter((s) => s.length > 0)
  if (labels.length === 0) {
    return ''
  }

  const parts = labels.map((label) => {
    const index = question.options.indexOf(label)
    if (index === -1) {
      // Free-text / unknown entry: pass the user's text straight through.
      return label
    }
    return formatQuestionOptionAtIndex(question, index) ?? label
  })

  return parts.join(question.multiSelect ? ', ' : ' ')
}

export function formatQuestionFreeTextAnswer(question: MobileChatQuestion, text: string): string {
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    return ''
  }
  return question.freeTextToken
    ? `${question.freeTextToken}:${encodeURIComponent(trimmed)}`
    : formatQuestionAnswer(question, [trimmed])
}
