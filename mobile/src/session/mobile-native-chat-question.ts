// Heuristic detection of an agent's "pick an option" prompt from its status /
// assistant text. Agents (Claude et al.) render these as a TUI choice list; we
// have no structured signal, so we parse the text conservatively and only treat
// it as a question when a clear option list is present.

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

type ParsedOption = {
  label: string
  token: string | null
}

// A pointer/highlight glyph some TUIs prefix onto the *currently selected* row.
// Stripped first so "❯ 2. Foo" parses identically to "2. Foo".
const POINTER_PREFIX = /^(\s*)(?:❯|›|»)\s+/

// Ordered most-specific-first so a numbered/lettered marker wins over the
// bullet fallback. `token` is the capture index of the leading marker (0 = none),
// `label` the capture index of the choice text.
const OPTION_PATTERNS: { re: RegExp; token: number; label: number }[] = [
  // 1. Option   12) Option
  { re: /^\s*(\d{1,2})[.)]\s+(\S.*?)\s*$/, token: 1, label: 2 },
  // [a] Option   [1] Option
  { re: /^\s*\[([0-9a-zA-Z])\]\s+(\S.*?)\s*$/, token: 1, label: 2 },
  // a) Option   a. Option   (single letter, to avoid eating prose like "e.g.")
  { re: /^\s*([a-zA-Z])[.)]\s+(\S.*?)\s*$/, token: 1, label: 2 },
  // - Option   * Option   • Option   > Option   (no token)
  { re: /^\s*(?:[-*•>])\s+(\S.*?)\s*$/, token: 0, label: 1 }
]

function parseOptionLine(line: string): (ParsedOption & { kind: number }) | null {
  const stripped = line.replace(POINTER_PREFIX, '$1')
  for (const [kind, { re, token, label }] of OPTION_PATTERNS.entries()) {
    const m = stripped.match(re)
    if (!m) {
      continue
    }
    const text = m[label].trim()
    if (text.length === 0) {
      continue
    }
    return { label: text, token: token > 0 ? m[token] : null, kind }
  }
  return null
}

/** Leading whitespace, with a pointer glyph counted as the indent it stands in
 *  for: a TUI draws `❯ 1. main` over `  2. develop`, one column of items. */
function lineIndent(line: string): number {
  const pointer = POINTER_PREFIX.exec(line)
  const flat = pointer ? ' '.repeat(pointer[0].length) + line.slice(pointer[0].length) : line
  return flat.length - flat.trimStart().length
}

type OptionList = {
  /** Line index of the first item. */
  start: number
  /** Line index of the last line that belongs to the list. */
  end: number
  items: ParsedOption[]
}

/**
 * The reply's lists, in order. One list is a run of items of one marker kind
 * at one indent; blank lines do not end it, and a deeper line (a sub-bullet, a
 * wrapped description) belongs to the item above it. Prose at the list's own
 * indent, or an item of another kind, ends it.
 */
function collectOptionLists(lines: readonly string[]): OptionList[] {
  const lists: OptionList[] = []
  let current: { list: OptionList; kind: number; indent: number } | null = null
  lines.forEach((line, index) => {
    if (line.trim().length === 0) {
      return
    }
    const indent = lineIndent(line)
    if (current && indent > current.indent) {
      current.list.end = index
      return
    }
    const option = parseOptionLine(line)
    if (option && current && option.kind === current.kind) {
      current.list.items.push(option)
      current.list.end = index
      return
    }
    if (!option) {
      current = null
      return
    }
    current = { list: { start: index, end: index, items: [option] }, kind: option.kind, indent }
    lists.push(current.list)
  })
  return lists
}

/** The nearest non-blank line above `list`, or -1 when there is none or it
 *  belongs to the list before it. */
function introIndex(lines: readonly string[], list: OptionList, previous: OptionList | null): number {
  let index = list.start - 1
  while (index >= 0 && lines[index].trim().length === 0) {
    index--
  }
  return previous && index <= previous.end ? -1 : index
}

const ASKS = /\?\s*$/

const MULTI_SELECT_HINT =
  /\b(select all|choose all|choose multiple|select multiple|pick multiple|all that apply|one or more|comma[- ]separated|multiple options)\b/i

// Question-like introducing line: ends in ? or :.
const QUESTION_LINE = /[?:]\s*$/

// Drop a trailing ":" off a card title but keep a meaningful "?".
function cleanQuestionText(raw: string): string {
  const trimmed = raw.trim()
  return trimmed.endsWith(':') ? trimmed.slice(0, -1).trim() : trimmed
}

/**
 * Heuristically parse a question + its option list from agent text. Returns null
 * when no clear option list is present (so ordinary prose is never treated as a
 * question). Conservative on purpose: requires at least two option lines, or one
 * option line introduced by a question-like prompt line.
 *
 * The options are ONE list: the reply's last, under the line directly above it.
 * A reply often lists findings before it asks, and taking every bullet sent a
 * finding back as the answer. With more than one list, the last must sit under
 * a line that asks (`?`), and no earlier list may sit under one too; otherwise
 * which list answers is a guess, and no card is shown.
 */
export function parseAgentQuestion(text: string): MobileChatQuestion | null {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return null
  }

  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const lists = collectOptionLists(lines)
  const list = lists.at(-1)
  if (!list) {
    return null
  }
  const previous = lists.at(-2) ?? null
  const options = list.items.map((item) => item.label)
  const optionTokens = list.items.map((item) => item.token)

  const questionIndex = introIndex(lines, list, previous)
  const question = questionIndex >= 0 ? lines[questionIndex] : ''
  const questionLooksLikePrompt = QUESTION_LINE.test(question)
  if (previous) {
    if (!ASKS.test(question)) {
      return null
    }
    const asksEarlier = lists
      .slice(0, -1)
      .some((earlier, i) => ASKS.test(lines[introIndex(lines, earlier, lists[i - 1] ?? null)] ?? ''))
    if (asksEarlier) {
      return null
    }
  }

  // Conservative gate: a single bare option with no introducing prompt is more
  // likely stray prose (a lone "- item") than a real choice list.
  if (options.length < 2 && !questionLooksLikePrompt) {
    return null
  }

  // A hint in the findings above says nothing about this list.
  const scope = previous ? lines.slice(previous.end + 1).join('\n') : text
  const multiSelect = MULTI_SELECT_HINT.test(scope) && options.length > 1

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
