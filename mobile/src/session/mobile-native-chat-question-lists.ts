// The option lists in an agent's reply, for the question card
// (mobile-native-chat-question.ts): where each list starts and ends, its
// items, and the line that introduces it.

export type ParsedOption = {
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
  // - Option   * Option   • Option   (no token). Not `> `: the reply is
  // Markdown, where that is a blockquote, and a quoted error is not a choice.
  { re: /^\s*(?:[-*•])\s+(\S.*?)\s*$/, token: 0, label: 1 }
]

/** An item's text that is only rule marks: `* * *` reads as a bullet
 *  holding `* *`, and `1. ---` as an item holding a rule. */
const RULE_TEXT = /^[-*_\s]+$/

function parseOptionLine(line: string): (ParsedOption & { kind: number }) | null {
  const stripped = line.replace(POINTER_PREFIX, '$1')
  for (const [kind, { re, token, label }] of OPTION_PATTERNS.entries()) {
    const m = stripped.match(re)
    if (!m) {
      continue
    }
    const text = m[label].trim()
    if (text.length === 0 || RULE_TEXT.test(text)) {
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

export type OptionList = {
  /** Line index of the first item. */
  start: number
  /** Line index of the last line that belongs to the list. */
  end: number
  items: ParsedOption[]
}

type OpenList = {
  list: OptionList
  kind: number
  indent: number
  /** The last item's marker ("2", "b"), or null for a bullet. */
  token: string | null
  /** A paragraph after the last item that may sit inside a loose list, and
   *  whether a blank line has followed it; null when there is none. */
  paragraph: { blankAfter: boolean } | null
}

// Question-like introducing line: ends in ? or :.
const QUESTION_LINE = /[?:]\s*$/
/** A line that asks: it ends in `?`. */
const ASKS = /\?\s*$/

/**
 * A line without the emphasis that wraps it: `**Which one?**`,
 * `__Which one?__`, `*Which one?*` and `**Which one**?` are all
 * `Which one?`. A line whose marks do not wrap it whole, `**a** or **b**?`,
 * is kept as written.
 */
export function unwrapEmphasis(line: string): string {
  const trimmed = line.trim()
  const wrapped = /^([*_`]{1,3})(\S(?:.*\S)?)\1([?:]?)$/.exec(trimmed)
  return wrapped && !wrapped[2].includes(wrapped[1][0]) ? wrapped[2] + wrapped[3] : trimmed
}

/** The line as its asking tests read it: unwrapped, and without marks that
 *  trail its last `?` or `:` (`Then **which one?**`). A bold question ends in
 *  `**`, and asked nothing, before this (review, 2026-09-30). */
function askingText(line: string): string {
  return unwrapEmphasis(line).replace(/([?:])[*_`]+$/, '$1')
}

/** Whether a line asks (`?`), bold or not. */
export function lineAsks(line: string): boolean {
  return ASKS.test(askingText(line))
}

/** Whether a line asks or introduces what follows (`?` or `:`), bold or not. */
export function lineIntroduces(line: string): boolean {
  return QUESTION_LINE.test(askingText(line))
}

/** Whether `next` is the marker after `previous`: 1 then 2, a then b. A bullet
 *  has no marker, so nothing says a bullet list goes on past a paragraph. */
function isNextMarker(previous: string | null, next: string | null): boolean {
  if (previous == null || next == null) {
    return false
  }
  if (/^\d+$/.test(previous) && /^\d+$/.test(next)) {
    return Number(next) === Number(previous) + 1
  }
  return (
    /^[a-z]$/i.test(previous) &&
    /^[a-z]$/i.test(next) &&
    next.charCodeAt(0) === previous.charCodeAt(0) + 1
  )
}

/** Whether `option` resumes the loose list `open` after a paragraph. */
function resumesAfterParagraph(
  open: OpenList,
  option: ParsedOption & { kind: number },
  indent: number
): boolean {
  return (
    open.paragraph?.blankAfter === true &&
    option.kind === open.kind &&
    indent === open.indent &&
    isNextMarker(open.token, option.token)
  )
}

/** A code fence's opening run: three or more backticks or tildes, first on
 *  its line. */
const FENCE_OPEN = /^\s*(`{3,}|~{3,})(.*)$/

/**
 * For each line, the index of the line that opened the code fence it is in
 * (its own index on the opening line), or -1 when it is not code. A fence
 * closes on a line holding only a run of its own character at least as long
 * as the one that opened it, as in CommonMark, so a ```` fence can hold a
 * ``` line and an info string closes nothing. One that never closes runs to
 * the end of the reply. A backtick run with a backtick after it on the line
 * is inline code, not a fence.
 */
export function codeFenceStarts(lines: readonly string[]): number[] {
  let open: { run: string; start: number } | null = null
  return lines.map((line, index) => {
    if (open === null) {
      const opener = FENCE_OPEN.exec(line)
      if (!opener || (opener[1].startsWith('`') && opener[2].includes('`'))) {
        return -1
      }
      open = { run: opener[1], start: index }
      return index
    }
    const { run, start } = open
    const trimmed = line.trim()
    if (trimmed.length >= run.length && trimmed === run[0].repeat(trimmed.length)) {
      open = null
    }
    return start
  })
}

/**
 * The reply's lists, in order. One list is a run of items of one marker kind
 * at one indent; blank lines do not end it, and a deeper line (a sub-bullet, a
 * wrapped description) belongs to the item above it. So does a line at the
 * list's own indent directly under the item with no blank line between (a
 * hard wrap to column 0, CommonMark's lazy continuation). A paragraph set off
 * by blank lines between two numbered or lettered items is part of a loose
 * list when the numbering goes on after it. A line that asks (`?` or `:`),
 * any other prose, or an item of another kind ends the list.
 *
 * No line of a code fence (`fenceStarts`, from codeFenceStarts) is an item:
 * a fenced YAML file or shell listing is code, not choices. A fence indented
 * under an item belongs to that item. One at the list's own indent is read
 * as a paragraph is, so the list goes on after it only when the numbering
 * does; a bullet list ends there.
 */
export function collectOptionLists(
  lines: readonly string[],
  fenceStarts: readonly number[]
): OptionList[] {
  const lists: OptionList[] = []
  let current: OpenList | null = null
  /** The list whose item holds the fence being read, if one does. */
  let fenceOwner: OpenList | null = null
  lines.forEach((line, index) => {
    if (fenceStarts[index] === index) {
      fenceOwner = null
      if (current?.paragraph) {
        current.paragraph.blankAfter = false
      } else if (current && lineIndent(line) > current.indent) {
        fenceOwner = current
      } else if (current) {
        current.paragraph = { blankAfter: false }
      }
    }
    if (fenceStarts[index] !== -1) {
      if (fenceOwner) {
        fenceOwner.list.end = index
      }
      return
    }
    if (line.trim().length === 0) {
      if (current?.paragraph) {
        current.paragraph.blankAfter = true
      }
      return
    }
    const indent = lineIndent(line)
    const option = parseOptionLine(line)
    if (current?.paragraph) {
      if (!option && !lineIntroduces(line)) {
        current.paragraph.blankAfter = false
        return
      }
      if (option && resumesAfterParagraph(current, option, indent)) {
        current.paragraph = null
      } else {
        current = null
      }
    }
    if (current && indent > current.indent) {
      current.list.end = index
      return
    }
    if (option && current && option.kind === current.kind) {
      current.list.items.push(option)
      current.list.end = index
      current.token = option.token
      return
    }
    if (!option) {
      if (!current || lineIntroduces(line)) {
        current = null
      } else if (current.list.end === index - 1) {
        current.list.end = index
      } else {
        current.paragraph = { blankAfter: false }
      }
      return
    }
    const list = { start: index, end: index, items: [option] }
    current = { list, kind: option.kind, indent, token: option.token, paragraph: null }
    lists.push(list)
  })
  return lists
}

/** The nearest non-blank line above `list`, or -1 when there is none, it
 *  belongs to the list before it, or it is code: a fence line is no title. */
export function introIndex(
  lines: readonly string[],
  list: OptionList,
  previous: OptionList | null,
  fenceStarts: readonly number[]
): number {
  let index = list.start - 1
  while (index >= 0 && lines[index].trim().length === 0) {
    index--
  }
  if (index < 0 || (previous && index <= previous.end) || fenceStarts[index] !== -1) {
    return -1
  }
  return index
}
