import type { LexedCommentBody } from './markdown-fences'
import type { ListItemShape, MarkdownBlock } from './markdown-blocks'

/**
 * The lists of a PR comment body, for markdown-blocks.ts.
 *
 * A list block keeps its items as the strings they always were, and where
 * any item is nested or a task, says per item how deep it sits, which kind of
 * list it is in, its number, and its box (`shapes`). A flat list reads as it
 * always did, `start` and all. The block was a flat run of strings before:
 * '- parent\n  - child' drew child as a sibling of parent, and a checklist's
 * '- [x] done' drew a literal "[x]" (review, 2026-09-30).
 *
 * An item nests under the one above when it is indented to that item's
 * words, as in CommonMark: two columns under `- `, three under `1. `. A
 * one-space indent stays a sibling. At the margin a marker of the other kind
 * ends the list, as before; under an item it opens a sub-list of its own
 * kind, numbered from its own first number. A task is `[x]`, `[X]` or `[ ]`
 * right after the marker, then a space or the end of the line.
 */

// One mark three or more times, spaces between allowed, at most three columns
// in (CommonMark 4.1), as THEMATIC_BREAK in markdown-code-ranges.ts reads it.
// `---+` alone let the list rule take `* * *` for a bullet reading "* *".
export const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
export const UNORDERED = /^\s*[-*+]\s+(.*)$/
export const ORDERED = /^\s*\d+[.)]\s+(.*)$/
/** Either marker, in the parts a column is counted from. */
const ITEM = /^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/
const TASK = /^\[([ xX])\](?:\s+|$)/

type Item = {
  ordered: boolean
  /** The column the marker line's indent reaches. */
  indent: number
  /** The column the item's words start at, which a child is indented to. */
  content: number
  number: number
  text: string
  checked?: boolean
}

type Level = { ordered: boolean; content: number; next: number }

/** The column `text` reaches from `column`, a tab to the next stop of four. */
function columnAfter(text: string, column: number): number {
  let at = column
  for (const char of text) {
    at = char === '\t' ? at + 4 - (at % 4) : at + 1
  }
  return at
}

function readItem(line: string): Item | null {
  const match = ITEM.exec(line)
  if (!match) {
    return null
  }
  const [, lead = '', marker = '', gap = '', rest = ''] = match
  const indent = columnAfter(lead, 0)
  const markerEnd = indent + marker.length
  const spaces = columnAfter(gap, markerEnd) - markerEnd
  const ordered = /\d/.test(marker)
  // CommonMark numbers a list from its first item's number, of at most nine
  // digits; a longer one parseInt rounds, so that list counts from 1.
  const digits = marker.slice(0, -1)
  const number = ordered && digits.length <= 9 ? Number(digits) : 1
  // Five spaces or more after the marker, or none before the end, and the
  // words start one column after it.
  const content = rest === '' || spaces > 4 ? markerEnd + 1 : markerEnd + spaces
  const task = TASK.exec(rest)
  return task
    ? { ordered, indent, content, number, text: rest.slice(task[0].length), checked: task[1] !== ' ' }
    : { ordered, indent, content, number, text: rest }
}

// The list opening at `lines[i]`, pushed onto `blocks`; returns the index after it.
export function parseList(lines: string[], i: number, body: LexedCommentBody, blocks: MarkdownBlock[]): number {
  const levels: Level[] = []
  let items: string[] = []
  let shapes: ListItemShape[] = []
  let flat = true
  const flush = (): void => {
    const ordered = levels[0]!.ordered
    const first = shapes[0]!.number ?? 1
    blocks.push(
      !flat
        ? { kind: 'list', ordered, items, shapes }
        : ordered && first !== 1
          ? { kind: 'list', ordered, items, start: first }
          : { kind: 'list', ordered, items }
    )
    items = []
    shapes = []
    flat = true
  }
  let item = readItem(lines[i]!)
  while (item) {
    // The deepest item whose words this one is indented to is its parent.
    let depth = levels.length
    while (depth > 0 && item.indent < levels[depth - 1]!.content) {
      depth -= 1
    }
    if (depth === 0 && levels.length > 0 && levels[0]!.ordered !== item.ordered) {
      break
    }
    levels.length = Math.min(levels.length, depth + 1)
    if (levels.length === depth + 1 && levels[depth]!.ordered !== item.ordered) {
      levels.length = depth
    }
    if (levels.length === depth) {
      levels.push({ ordered: item.ordered, content: item.content, next: item.number })
    }
    const level = levels[depth]!
    level.content = item.content
    // A fence can open on the item's own line; the item then holds only it.
    let fence = body.fenceOn(item.text)?.code ?? null
    // A wrapped item continues on the lines under it: indented, non-blank,
    // and not a marker of its own. Without this the list ended at the first
    // continuation line, that line became a paragraph at the left margin,
    // and the next item opened a fresh list — so every item was numbered 1.
    // GitHub comment bodies are hard-wrapped by every editor that soft-wraps.
    const parts = fence ? [] : [item.text.trim()]
    i += 1
    while (!fence && i < lines.length) {
      const next = lines[i]!
      if (!next.trim() || !/^\s/.test(next) || ORDERED.test(next) || UNORDERED.test(next)) {
        break
      }
      fence = body.fenceOn(next)?.code ?? null
      if (!fence) {
        parts.push(next.trim())
      }
      i += 1
    }
    // Joined with a space: a single newline inside a paragraph is not a line
    // break in markdown, it reflows.
    items.push(parts.join(' '))
    const shape: ListItemShape = level.ordered ? { depth, ordered: true, number: level.next } : { depth, ordered: false }
    if (item.checked !== undefined) {
      shape.checked = item.checked
    }
    shapes.push(shape)
    flat &&= depth === 0 && item.checked === undefined
    level.next += 1
    if (fence) {
      // A fence under an item ends the item: the list so far, then the code,
      // and the list goes on, still counting, at the next marker.
      flush()
      blocks.push({ kind: 'code', ...fence })
    }
    // A rule ends the list, though `* * *` and `- - -` fit a marker: a rule wins
    // where a line could be either (CommonMark 4.1). It read as a bullet "* *".
    item = i < lines.length && !HR.test(lines[i]!) ? readItem(lines[i]!) : null
  }
  if (items.length > 0) {
    flush()
  }
  return i
}
