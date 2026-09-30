import { closesFence, openingFence, outdentCodeLine, type OpeningFence } from './markdown-code-fence'
import { quoteLineContent } from './markdown-quote'
import { opensTable, readTableRows } from './markdown-table-rows'

/**
 * The blocks a list item holds after its words, read the way CommonMark reads an item's
 * container: a line belongs to the item while it sits at or past the item's content column (where
 * its words start: two columns in for `- `, three for `1. `), and a fence there is the item's
 * code block, with the content column taken off every line of it. A quote there is the item's
 * quote, its lines read as any quote's are (markdown-quote.ts), and a table is the item's table.
 *
 * Until 2026-09-30 the item's wrapped-words reader took an indented fence for more words, so
 * '- a\n  ```\n  code\n  ```\n- b', the commonest shape in a CLAUDE.md, saved as '- a ``` code ```',
 * and a quote the same way: '- a\n  > quote' saved as '- a > quote'. A table there ended the list,
 * so a save wrote it at the margin, outside the item.
 */

/** A fenced block inside an item. */
export type ItemCodeBlock = {
  kind: 'code'
  fence: OpeningFence
  /** The code's lines, with the item's columns taken off. */
  code: readonly string[]
  /**
   * Columns from the item's own line to the fence, or null for a fence on the item's marker line,
   * which always sits at the marker's width.
   */
  offset: number | null
  /** Whether a blank line stood between the block and what came before it in the item. */
  blankBefore: boolean
  /** How many of the item's nested items came before the block, which is where it is drawn. */
  afterChildren: number
}

/** A paragraph inside an item after its first, or an indented code block there. */
export type ItemLeafBlock = {
  kind: 'paragraph' | 'indented-code'
  /** The paragraph's words, reflowed, or the code with its columns taken off. */
  text: string
  /** Columns from the item's own line to where the paragraph's words or the code start. */
  offset: number
  /** Whether a blank line stood before it: a paragraph right after a fence need not have one. */
  blankBefore: boolean
  afterChildren: number
}

/** A quote inside an item. */
export type ItemQuoteBlock = {
  kind: 'quote'
  /** The quote's lines, with the item's columns and their markers taken off. */
  lines: readonly string[]
  /** Columns from the item's own line to the quote's marker, or null for one on the marker line. */
  offset: number | null
  blankBefore: boolean
  afterChildren: number
}

/** A table inside an item. */
export type ItemTableBlock = {
  kind: 'table'
  /** Its header line, its separator line and its rows, as written. */
  lines: readonly string[]
  /** Columns from the item's own line to the header, or null for one on the marker line. */
  offset: number | null
  blankBefore: boolean
  afterChildren: number
}

export type ItemBlock = ItemCodeBlock | ItemQuoteBlock | ItemTableBlock | ItemLeafBlock

/** The spaces a line starts with. A tab is not read as indent here, so a tabbed fence is words. */
export function leadingSpaces(line: string): number {
  let count = 0
  while (line[count] === ' ') {
    count += 1
  }
  return count
}

/** The columns a line's leading whitespace reaches, a tab going on to the next multiple of four. */
function leadingColumns(line: string): number {
  let columns = 0
  for (const char of line) {
    if (char === ' ') {
      columns += 1
    } else if (char === '\t') {
      columns += 4 - (columns % 4)
    } else {
      break
    }
  }
  return columns
}

/**
 * The code of a fence opened under an item whose words start at `contentColumn`, from `index`:
 * up to its closing fence, or to the first non-blank line left of the content column, where the
 * item ends and its fence with it (a save closes it), or to the end of the document. A code line
 * that starts with a tab, as a Makefile recipe must, reaches the column the tab does.
 */
export function readItemFenceBody(
  lines: readonly string[],
  index: number,
  fence: OpeningFence,
  contentColumn: number
): { code: string[]; nextIndex: number } {
  const codeColumns = contentColumn + fence.indent
  const code: string[] = []
  let next = index
  while (next < lines.length) {
    const line = lines[next] ?? ''
    if (line.trim() && leadingColumns(line) < contentColumn) {
      break
    }
    next += 1
    if (closesFence(outdentCodeLine(line, contentColumn), fence.fence)) {
      break
    }
    code.push(outdentCodeLine(line, codeColumns))
  }
  return { code, nextIndex: next }
}

/**
 * Whether a line ends an item's wrapped words by opening a fence: up to three columns past the
 * content column, or left of it, where it is the document's fence (CommonMark lets a fence break
 * into a paragraph). A fence four columns past it is words, as an indented code block is.
 */
function opensFenceUnder(line: string, contentColumn: number): boolean {
  return (
    leadingSpaces(line) <= contentColumn + 3 && openingFence(line.trimStart()) !== null
  )
}

/**
 * A quote line under an item whose words start at `contentColumn`, its marker up to three columns
 * past that column, as its content with the marker off; null for any other line.
 */
function itemQuoteLine(line: string, contentColumn: number): string | null {
  const spaces = leadingSpaces(line)
  return spaces >= contentColumn && spaces <= contentColumn + 3
    ? quoteLineContent(line.slice(spaces))
    : null
}

/** A quote whose first line, marker off, is `first`, and the item's quote lines from `index` on. */
function readItemQuoteLines(
  lines: readonly string[],
  index: number,
  first: string,
  contentColumn: number
): { lines: string[]; nextIndex: number } {
  const quoted = [first]
  let next = index
  while (next < lines.length) {
    const content = itemQuoteLine(lines[next] ?? '', contentColumn)
    if (content === null) {
      break
    }
    quoted.push(content)
    next += 1
  }
  return { lines: quoted, nextIndex: next }
}

/** The quote an item holds from `index`, or null when that line opens none there. */
export function readItemQuote(
  lines: readonly string[],
  index: number,
  contentColumn: number
): { lines: string[]; nextIndex: number } | null {
  const first = itemQuoteLine(lines[index] ?? '', contentColumn)
  return first === null ? null : readItemQuoteLines(lines, index + 1, first, contentColumn)
}

/**
 * Whether a line ends an item's wrapped words by opening a quote: up to three columns past the
 * content column, or left of it, where the quote is the document's, as marked reads '- a\n > q'.
 * A quote's marker never continues a paragraph, as a line four columns past it does.
 */
function opensQuoteUnder(line: string, contentColumn: number): boolean {
  return leadingSpaces(line) <= contentColumn + 3 && line.trimStart().startsWith('>')
}

/**
 * Whether a line and the one under it open a table an item whose words start at `contentColumn`
 * holds: its header up to three columns past that column, and its separator not left of it. A
 * table left of it stays what it always was, the item's words; marked takes it into the item as a
 * lazy line, and the item's reader does not read lines lazily.
 */
function opensTableUnder(line: string, under: string | undefined, contentColumn: number): boolean {
  const spaces = leadingSpaces(line)
  return (
    spaces >= contentColumn &&
    spaces <= contentColumn + 3 &&
    under !== undefined &&
    leadingSpaces(under) >= contentColumn &&
    opensTable(line, under)
  )
}

/** The table an item holds from `index`, its lines as written, or null when none opens there. */
export function readItemTable(
  lines: readonly string[],
  index: number,
  contentColumn: number
): { lines: string[]; nextIndex: number } | null {
  if (!opensTableUnder(lines[index] ?? '', lines[index + 1], contentColumn)) {
    return null
  }
  const body = readTableRows(lines, index + 2, contentColumn)
  return { lines: lines.slice(index, index + 2).concat(body.rows), nextIndex: body.nextIndex }
}

/** Whether a line ends an item's wrapped words by opening a block: a fence, a quote, a table. */
export function endsItemWords(
  line: string,
  under: string | undefined,
  contentColumn: number
): boolean {
  return (
    opensFenceUnder(line, contentColumn) ||
    opensQuoteUnder(line, contentColumn) ||
    opensTableUnder(line, under, contentColumn)
  )
}

/**
 * The block an item's marker line opens rather than words: a fence ('- ```'), a quote ('- > a')
 * or a table's header ('- | x |' over its separator), and the lines under it at the content column
 * that are the block's. Null when the item's first words are words.
 */
export function markerLineBlock(
  lines: readonly string[],
  index: number,
  text: string,
  contentColumn: number
): { block: ItemBlock; nextIndex: number } | null {
  const opened = { offset: null, blankBefore: false, afterChildren: 0 }
  const fence = openingFence(text)
  if (fence !== null) {
    const body = readItemFenceBody(lines, index, fence, contentColumn)
    return { block: { kind: 'code', fence, code: body.code, ...opened }, nextIndex: body.nextIndex }
  }
  const quoted = quoteLineContent(text)
  if (quoted !== null) {
    const quote = readItemQuoteLines(lines, index, quoted, contentColumn)
    return { block: { kind: 'quote', lines: quote.lines, ...opened }, nextIndex: quote.nextIndex }
  }
  const separator = lines[index]
  if (
    separator !== undefined &&
    leadingSpaces(separator) >= contentColumn &&
    opensTable(text, separator)
  ) {
    const body = readTableRows(lines, index + 1, contentColumn)
    const table = [text, separator, ...body.rows]
    return { block: { kind: 'table', lines: table, ...opened }, nextIndex: body.nextIndex }
  }
  return null
}
