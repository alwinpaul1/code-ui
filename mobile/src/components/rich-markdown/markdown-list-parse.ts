import { gatherListItemContinuation } from './markdown-reflow'
import { openingFence, outdentCodeLine } from './markdown-code-fence'
import {
  leadingSpaces,
  opensFenceUnder,
  readItemFenceBody,
  type ItemBlock
} from './markdown-list-blocks'

/** One list line, with its marker read and its nesting resolved against the lines around it. */
export type ParsedListItem = {
  indent: number
  /** The column the item's words start at, which its later lines and blocks are measured from. */
  contentIndent: number
  ordered: boolean
  orderedNumber: number | null
  /** Whether the item's checkbox is ticked, or null when it is not a task at all. */
  task: boolean | null
  text: string
  children: ParsedListItem[]
  /** The blocks after the item's words (markdown-list-blocks.ts), in order. */
  blocks: ItemBlock[]
}

/** A tab indents as far as four spaces, so mixed indentation still nests the way it looks. */
export function indentationWidth(value: string): number {
  return value.replace(/\t/g, '    ').length
}

/**
 * A thematic break: one of `-`, `*` or `_` three or more times, with spaces or tabs between them
 * allowed (CommonMark 4.1), as the PR renderer's HR reads it. The rule test took only an unbroken
 * run, so `* * *` and `- - -` read as a bullet holding the rest of the marks and saved as a list
 * item, and `_ _ _` as words (review, 2026-09-30).
 *
 * Here rather than in the block reader because both readers need it and the block reader imports
 * this one. A break wins over a list item where a line could be either, as in CommonMark. Any
 * indent, as the editor's rule test has always allowed rather than CommonMark's three columns: an
 * indented `---` under a list item has always ended the item as a rule, and three columns would
 * gather it into the item's words instead.
 */
export function isThematicBreak(line: string): boolean {
  return /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line)
}

export function parseListLine(line: string): ParsedListItem | null {
  if (isThematicBreak(line)) {
    return null
  }
  const match = line.match(/^(\s*)((?:[-*+])|(?:\d+[.)]))(\s+)(.+)$/)
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
    task: task ? task[1]!.toLowerCase() === 'x' : null,
    text: task ? task[2]! : rawText,
    children: [],
    blocks: []
  }
}

/** Which of the three list shapes an item belongs to; a run of one kind becomes one list. */
export function listKind(item: ParsedListItem): 'task' | 'ol' | 'ul' {
  if (item.task !== null) {
    return 'task'
  }
  return item.ordered ? 'ol' : 'ul'
}

type ListLevel = { indent: number; children: ParsedListItem[] }

function isItem(level: ListLevel): level is ParsedListItem {
  return 'contentIndent' in level
}

/**
 * A block at `index`, past any blank lines, that belongs to an open item rather than ending the
 * list: the deepest item whose content column the line reaches owns it. Null when no item does,
 * or when what is there is no block an item takes (yet only a fence), which ends the list.
 */
function readOwnedBlock(
  lines: string[],
  index: number,
  stack: ListLevel[]
): { depth: number; block: ItemBlock; nextIndex: number } | null {
  let next = index
  while (next < lines.length && !(lines[next] ?? '').trim()) {
    next += 1
  }
  if (next >= lines.length) {
    return null
  }
  const line = lines[next] ?? ''
  const column = leadingSpaces(line)
  for (let depth = stack.length - 1; depth >= 1; depth -= 1) {
    const owner = stack[depth]!
    if (!isItem(owner) || column < owner.contentIndent) {
      continue
    }
    const fence = openingFence(outdentCodeLine(line, owner.contentIndent))
    if (fence === null) {
      return null
    }
    const body = readItemFenceBody(lines, next + 1, fence, owner.contentIndent)
    const block: ItemBlock = {
      kind: 'code',
      fence,
      code: body.code,
      offset: owner.contentIndent + fence.indent - owner.indent,
      blankBefore: next > index,
      afterChildren: owner.children.length
    }
    return { depth, block, nextIndex: body.nextIndex }
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
 * A fence ends it too, where the item can hold it (markdown-list-blocks.ts).
 */
export function parseListTree(
  lines: string[],
  startIndex: number,
  opensBlock: (line: string) => boolean
): { items: ParsedListItem[]; nextIndex: number } {
  const root: ListLevel = { indent: -1, children: [] }
  const stack: ListLevel[] = [root]
  let index = startIndex
  while (index < lines.length) {
    const item = parseListLine(lines[index] ?? '')
    if (!item) {
      const owned = readOwnedBlock(lines, index, stack)
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
    stack[stack.length - 1]!.children.push(item)
    stack.push(item)
    index += 1
    // An item whose words are a fence holds the code block from its marker line on. Not a task:
    // its box is its words, and a fence after it is text.
    const fence = item.task === null ? openingFence(item.text) : null
    if (fence !== null) {
      const body = readItemFenceBody(lines, index, fence, item.contentIndent)
      item.text = ''
      item.blocks.push({
        kind: 'code',
        fence,
        code: body.code,
        offset: null,
        blankBefore: false,
        afterChildren: 0
      })
      index = body.nextIndex
      continue
    }
    const continued = gatherListItemContinuation(
      lines,
      index,
      item.text,
      (line) => parseListLine(line) !== null,
      (line) => opensBlock(line) || opensFenceUnder(line, item.contentIndent)
    )
    item.text = continued.text
    index = continued.nextIndex
  }
  return { items: root.children, nextIndex: index }
}
