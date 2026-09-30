import { gatherListItemContinuation } from './markdown-reflow'
import { openingFence, outdentCodeLine } from './markdown-code-fence'
import { readIndentedCode, setextLevel } from './markdown-leaf-blocks'
import { continuesParagraphLazily, isThematicBreak } from './markdown-lazy-line'
import { opensTable } from './markdown-table-rows'
import {
  endsItemWords,
  leadingSpaces,
  markerLineBlock,
  readItemFenceBody,
  readItemQuote,
  readItemTable,
  type ItemBlock
} from './markdown-list-blocks'

/** One list line, with its marker read and its nesting resolved against the lines around it. */
export type ParsedListItem = {
  indent: number
  /** The column the item's words start at, which its later lines and blocks are measured from. */
  contentIndent: number
  ordered: boolean
  orderedNumber: number | null
  /** What follows an ordered item's number, `.` or `)`; null for a bullet. */
  delimiter: '.' | ')' | null
  /** Whether the item's checkbox is ticked, or null when it is not a task at all. */
  task: boolean | null
  text: string
  children: ParsedListItem[]
  /** The blocks after the item's words (markdown-list-blocks.ts), in order. */
  blocks: ItemBlock[]
  /**
   * Whether a blank line stood above the item, which only a nested one can have: past a blank line
   * the list goes on only into an open item's words, a loose sublist ('- a\n\n  - b').
   */
  blankBefore: boolean
}

/** A tab indents as far as four spaces, so mixed indentation still nests the way it looks. */
export function indentationWidth(value: string): number {
  return value.replace(/\t/g, '    ').length
}

/** A list line: its indent, its marker, the gap after it, and its words. */
const LIST_LINE = /^(\s*)((?:[-*+])|(?:\d+[.)]))(\s+)(.+)$/

export function parseListLine(line: string): ParsedListItem | null {
  if (isThematicBreak(line)) {
    return null
  }
  const match = line.match(LIST_LINE)
  if (!match) {
    return null
  }
  const marker = match[2] ?? ''
  const rawText = match[4] ?? ''
  const task = rawText.match(/^\[([ xX])\]\s+(.+)$/)
  const ordered = /^\d/.test(marker)
  const indent = indentationWidth(match[1] ?? '')
  // Five columns or more after the marker are one column and an indented code block (CommonMark).
  const gap = indentationWidth(match[3] ?? '')
  return {
    indent,
    contentIndent: indent + marker.length + (gap >= 5 ? 1 : gap),
    ordered,
    orderedNumber: ordered ? Number.parseInt(marker, 10) : null,
    delimiter: ordered ? (marker.endsWith(')') ? ')' : '.') : null,
    task: task ? task[1]!.toLowerCase() === 'x' : null,
    text: task ? task[2]! : rawText,
    children: [],
    blocks: [],
    blankBefore: false
  }
}

/**
 * Which of the four list shapes an item belongs to; a run of one kind becomes one list. A numbered
 * task list is a kind of its own: it was a task list like any other until 2026-09-30, drawn and
 * saved bulleted, so '1. [ ] a' saved as '- [ ] a'.
 */
export function listKind(item: ParsedListItem): 'task' | 'ordered-task' | 'ol' | 'ul' {
  if (item.task !== null) {
    return item.ordered ? 'ordered-task' : 'task'
  }
  return item.ordered ? 'ol' : 'ul'
}

type ListLevel = { indent: number; children: ParsedListItem[] }

function isItem(level: ListLevel): level is ParsedListItem {
  return 'contentIndent' in level
}

/**
 * Whether an item's last content is a block of its own (code, a quote, a table), after which a
 * line needs no blank to start: it cannot be more of that block's words.
 */
function endsInBlock(owner: ParsedListItem): boolean {
  const last = owner.blocks[owner.blocks.length - 1]
  return last !== undefined && last.kind !== 'paragraph' && last.afterChildren === owner.children.length
}

/** An item's marker line with its marker as spaces, so its words sit at the item's content column. */
function markerAsSpaces(line: string): string {
  return line.replace(
    LIST_LINE,
    (_line, indent: string, marker: string, gap: string, words: string) =>
      `${indent}${' '.repeat(marker.length)}${gap}${words}`
  )
}

/**
 * Whether an item's line, with the columns up to its words taken off, is paragraph text that a
 * line at the margin may continue lazily. It is not when it is blank, four columns or more past
 * the item's words, a fence, a rule, or a heading: marked (the desktop's reader) ends the item
 * under any `#` up to `reach` columns in, `#H` included, and CommonMark under an ATX heading up to
 * three. Where the two disagree the item ends there too, rather than guess.
 */
function takesLazyLine(words: string, reach: number): boolean {
  return (
    words.trim() !== '' &&
    !/^(?: {4}| {0,3}\t)/.test(words) &&
    !(words.trimStart().startsWith('#') && leadingSpaces(words) <= reach) &&
    !/^ {0,3}#{1,6}(?:[ \t]|$)/.test(words) &&
    openingFence(words) === null &&
    !isThematicBreak(words)
  )
}

/**
 * Whether a line ends an item's words, or a paragraph after them: it opens a block of its own
 * (`opensBlock`, or a fence, a quote or a table the item holds), or it sits at the margin and is no
 * lazy line (markdown-lazy-line.ts), or the line `above` it, as written, is no paragraph text that
 * a lazy line continues (`takesLazyLine`). Until 2026-10-01 a line at the margin joined whatever
 * the item's last line was, so '- # H\nlazy' saved '- # H lazy', one heading to marked, and
 * '- ***\nlazy' saved '- *** lazy', a rule become words. Nor is an underline there: marked reads
 * '- a\n===' as a heading inside the item, which the item's reader cannot hold, so the item ends at
 * it as it always did. A line indented less than the item's words has always been more of them.
 */
function endsWords(
  line: string,
  under: string | undefined,
  above: string,
  item: ParsedListItem,
  opensBlock: (line: string) => boolean
): boolean {
  // marked tests the line above for a `#` up to one column short of the item's words, three at most.
  const reach = Math.min(3, item.contentIndent - item.indent - 1)
  return (
    opensBlock(line) ||
    endsItemWords(line, under, item.contentIndent) ||
    (!/^\s/.test(line) &&
      (!continuesParagraphLazily(line, under) ||
        setextLevel(line) !== null ||
        !takesLazyLine(outdentCodeLine(above, item.contentIndent), reach)))
  )
}

type OwnedBlock = { depth: number; block: ItemBlock; nextIndex: number }

/**
 * The block an item owns at `next`: a fence, a quote, a table, an indented code block four columns
 * past its words, or another paragraph of words. A paragraph or indented code needs a blank line
 * before it (without one the line would have been the item's words) unless it follows a code
 * block, a quote or a table. Indented code is code whatever its words look like: a marker or a
 * rule four columns past the item's words ended the list until 2026-09-30, so '- a\n\n      - b'
 * saved as '- a\n\n- b'. Any other line that opens a block of its own, or a table the item cannot
 * hold, is not one: it ends the list, as it always has.
 */
function readBlockOf(
  lines: string[],
  next: number,
  blank: boolean,
  owner: ParsedListItem,
  opensBlock: (line: string) => boolean
): { block: ItemBlock; nextIndex: number } | null {
  const line = lines[next] ?? ''
  const fence = openingFence(outdentCodeLine(line, owner.contentIndent))
  if (fence !== null) {
    const body = readItemFenceBody(lines, next + 1, fence, owner.contentIndent)
    return {
      block: {
        kind: 'code',
        fence,
        code: body.code,
        offset: owner.contentIndent + fence.indent - owner.indent,
        blankBefore: blank,
        afterChildren: owner.children.length
      },
      nextIndex: body.nextIndex
    }
  }
  const leaf = { blankBefore: blank, afterChildren: owner.children.length }
  const quote = readItemQuote(lines, next, owner.contentIndent)
  if (quote !== null) {
    const offset = leadingSpaces(line) - owner.indent
    return { block: { kind: 'quote', lines: quote.lines, offset, ...leaf }, nextIndex: quote.nextIndex }
  }
  const table = readItemTable(lines, next, owner.contentIndent)
  if (table !== null) {
    const offset = leadingSpaces(line) - owner.indent
    return { block: { kind: 'table', lines: table.lines, offset, ...leaf }, nextIndex: table.nextIndex }
  }
  if (!blank && !endsInBlock(owner)) {
    return null
  }
  const code = readIndentedCode(lines, next, owner.contentIndent)
  if (code !== null) {
    const offset = owner.contentIndent + 4 - owner.indent
    return { block: { kind: 'indented-code', text: code.code, offset, ...leaf }, nextIndex: code.nextIndex }
  }
  if (opensBlock(line) || opensTable(line, lines[next + 1])) {
    return null
  }
  const words = gatherListItemContinuation(
    lines,
    next + 1,
    line.trim(),
    (candidate) => parseListLine(candidate) !== null,
    (candidate, under, above) => endsWords(candidate, under, above ?? line, owner, opensBlock)
  )
  const offset = leadingSpaces(line) - owner.indent
  return { block: { kind: 'paragraph', text: words.text, offset, ...leaf }, nextIndex: words.nextIndex }
}

/**
 * A block at `index`, past any blank lines, that belongs to an open item rather than ending the
 * list: the deepest item whose content column the line reaches owns it. Null when no item does,
 * or when what is there is no block an item takes, which ends the list.
 */
function readOwnedBlock(
  lines: string[],
  index: number,
  stack: ListLevel[],
  opensBlock: (line: string) => boolean
): OwnedBlock | null {
  let next = index
  while (next < lines.length && !(lines[next] ?? '').trim()) {
    next += 1
  }
  if (next >= lines.length) {
    return null
  }
  const column = leadingSpaces(lines[next] ?? '')
  for (let depth = stack.length - 1; depth >= 1; depth -= 1) {
    const owner = stack[depth]!
    if (!isItem(owner) || column < owner.contentIndent) {
      continue
    }
    const read = readBlockOf(lines, next, next > index, owner, opensBlock)
    return read === null ? null : { depth, ...read }
  }
  return null
}

/**
 * The list line past the blank lines at `index` that nests under an open item, a loose sublist
 * ('- a\n\n  - b'): indented to the item's words, and less than four columns past them, where it
 * would be the item's code. Null where there is none. A marker left of every open item's words
 * ends the list there, as any line that opens a block does (readOwnedBlock).
 *
 * The list ended at every blank line before a marker until 2026-09-30, so a save wrote `b` at the
 * margin as `a`'s sibling, and under a numbered item cut the numbering in two.
 */
function nestedItemAfterBlank(lines: string[], index: number, stack: ListLevel[]): number | null {
  let next = index
  while (next < lines.length && !(lines[next] ?? '').trim()) {
    next += 1
  }
  const item = next > index ? parseListLine(lines[next] ?? '') : null
  if (item === null) {
    return null
  }
  for (let depth = stack.length - 1; depth >= 1; depth -= 1) {
    const owner = stack[depth]!
    if (isItem(owner) && item.indent >= owner.contentIndent) {
      return item.indent < owner.contentIndent + 4 ? next : null
    }
  }
  return null
}

/**
 * The run of list lines starting at an index, as a tree, and where the run ended.
 *
 * A stack rather than recursion because indentation can drop by more than one level at a time, and
 * the caller needs the index the run stopped at to carry on reading blocks after it.
 *
 * `opensBlock` is the block reader's test for a line that starts a block of its own, which ends a
 * wrapped item's continuation (markdown-reflow.ts). Passed in because the block reader imports this.
 * A fence, a quote or a table ends it too, where the item can hold it (markdown-list-blocks.ts).
 */
export function parseListTree(
  lines: string[],
  startIndex: number,
  opensBlock: (line: string) => boolean
): { items: ParsedListItem[]; nextIndex: number } {
  const root: ListLevel = { indent: -1, children: [] }
  const stack: ListLevel[] = [root]
  let index = startIndex
  let blankBefore = false
  while (index < lines.length) {
    const item = parseListLine(lines[index] ?? '')
    if (!item) {
      const nested = nestedItemAfterBlank(lines, index, stack)
      if (nested !== null) {
        index = nested
        blankBefore = true
        continue
      }
      const owned = readOwnedBlock(lines, index, stack, opensBlock)
      if (owned === null) {
        break
      }
      stack.length = owned.depth + 1
      ;(stack[owned.depth] as ParsedListItem).blocks.push(owned.block)
      index = owned.nextIndex
      continue
    }
    while (stack.length > 1 && item.indent <= stack[stack.length - 1]!.indent) {
      stack.pop()
    }
    item.blankBefore = blankBefore
    blankBefore = false
    stack[stack.length - 1]!.children.push(item)
    stack.push(item)
    index += 1
    // An item whose words are a fence, a quote or a table holds that block from its marker line on.
    // Not a task: its box is its words, and a block after it is text.
    const opened =
      item.task === null ? markerLineBlock(lines, index, item.text, item.contentIndent) : null
    if (opened !== null) {
      item.text = ''
      item.blocks.push(opened.block)
      index = opened.nextIndex
      continue
    }
    const markerLine = markerAsSpaces(lines[index - 1] ?? '')
    const continued = gatherListItemContinuation(
      lines,
      index,
      item.text,
      (line) => parseListLine(line) !== null,
      (line, under, above) => endsWords(line, under, above ?? markerLine, item, opensBlock)
    )
    item.text = continued.text
    index = continued.nextIndex
  }
  return { items: root.children, nextIndex: index }
}
