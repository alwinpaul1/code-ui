import { closesFence, openingFence, outdentCodeLine, type OpeningFence } from './markdown-code-fence'

/**
 * The blocks a list item holds after its words, read the way CommonMark reads an item's
 * container: a line belongs to the item while it sits at or past the item's content column (where
 * its words start: two columns in for `- `, three for `1. `), and a fence there is the item's
 * code block, with the content column taken off every line of it.
 *
 * Until 2026-09-30 the item's wrapped-words reader took an indented fence for more words, so
 * '- a\n  ```\n  code\n  ```\n- b', the commonest shape in a CLAUDE.md, saved as '- a ``` code ```'.
 */

/** A fenced block inside an item. */
export type ItemCodeBlock = {
  kind: 'code'
  fence: OpeningFence
  code: string
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

export type ItemBlock = ItemCodeBlock | ItemLeafBlock

/** The spaces a line starts with. A tab is not read as indent here, so a tabbed fence is words. */
export function leadingSpaces(line: string): number {
  let count = 0
  while (line[count] === ' ') {
    count += 1
  }
  return count
}

/**
 * The code of a fence opened under an item whose words start at `contentColumn`, from `index`:
 * up to its closing fence, or to the first non-blank line left of the content column, where the
 * item ends and its fence with it (a save closes it), or to the end of the document.
 */
export function readItemFenceBody(
  lines: readonly string[],
  index: number,
  fence: OpeningFence,
  contentColumn: number
): { code: string; nextIndex: number } {
  const codeColumns = contentColumn + fence.indent
  const code: string[] = []
  let next = index
  while (next < lines.length) {
    const line = lines[next] ?? ''
    if (line.trim() && leadingSpaces(line) < contentColumn) {
      break
    }
    next += 1
    if (closesFence(outdentCodeLine(line, contentColumn), fence.fence)) {
      break
    }
    code.push(outdentCodeLine(line, codeColumns))
  }
  return { code: code.join('\n'), nextIndex: next }
}

/**
 * Whether a line ends an item's wrapped words by opening a fence: up to three columns past the
 * content column, or left of it, where it is the document's fence (CommonMark lets a fence break
 * into a paragraph). A fence four columns past it is words, as an indented code block is.
 */
export function opensFenceUnder(line: string, contentColumn: number): boolean {
  return (
    leadingSpaces(line) <= contentColumn + 3 && openingFence(line.trimStart()) !== null
  )
}
