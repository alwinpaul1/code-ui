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
export const QUESTION_LINE = /[?:]\s*$/

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

/**
 * The reply's lists, in order. One list is a run of items of one marker kind
 * at one indent; blank lines do not end it, and a deeper line (a sub-bullet, a
 * wrapped description) belongs to the item above it. So does a line at the
 * list's own indent directly under the item with no blank line between (a
 * hard wrap to column 0, CommonMark's lazy continuation). A paragraph set off
 * by blank lines between two numbered or lettered items is part of a loose
 * list when the numbering goes on after it. A line that asks (`?` or `:`),
 * any other prose, or an item of another kind ends the list.
 */
export function collectOptionLists(lines: readonly string[]): OptionList[] {
  const lists: OptionList[] = []
  let current: OpenList | null = null
  lines.forEach((line, index) => {
    if (line.trim().length === 0) {
      if (current?.paragraph) {
        current.paragraph.blankAfter = true
      }
      return
    }
    const indent = lineIndent(line)
    const option = parseOptionLine(line)
    if (current?.paragraph) {
      if (!option && !QUESTION_LINE.test(line)) {
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
      if (!current || QUESTION_LINE.test(line)) {
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

/** The nearest non-blank line above `list`, or -1 when there is none or it
 *  belongs to the list before it. */
export function introIndex(
  lines: readonly string[],
  list: OptionList,
  previous: OptionList | null
): number {
  let index = list.start - 1
  while (index >= 0 && lines[index].trim().length === 0) {
    index--
  }
  return previous && index <= previous.end ? -1 : index
}
