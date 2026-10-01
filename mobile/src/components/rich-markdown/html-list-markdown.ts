import { breakMark, inlineMarkdown } from './html-inline-markdown'
import { markedBreaksMarkdown, paragraphMarkdown } from './html-paragraph-markdown'
import { codeBlockMarkdown, writesIndented } from './html-code-block-markdown'
import { CODE_BLANK_ATTRIBUTE, CODE_INDENT_ATTRIBUTE } from './markdown-code-fence'
import { INDENTED_CODE_ATTRIBUTE } from './markdown-leaf-blocks'
import {
  ITEM_BLANK_ATTRIBUTE,
  ITEM_TIGHT_ATTRIBUTE,
  LIST_DELIMITER_ATTRIBUTE,
  LIST_INDENT_ATTRIBUTE,
  ORDERED_TASK_ATTRIBUTE
} from './markdown-list-render'

/** One piece of what an item holds, in order: words, a code block, a quote, a table or a list. */
type ItemPart =
  | { kind: 'words'; words: string; element: Element | null }
  | { kind: 'list'; element: Element }
  | { kind: 'code'; element: Element }
  | { kind: 'quote'; element: Element }
  | { kind: 'table'; element: Element }

/**
 * A block element written as markdown at the margin: html-block-markdown.ts's `blockMarkdown`,
 * handed in because that module imports this one. It writes an item's quote and table.
 */
export type BlockWriter = (block: Element) => string

/**
 * The writer a caller with none gets: the element's words, which is how an item's quote or table
 * was written until 2026-09-30. Only a test that writes a list with neither in it calls without one.
 */
const wordsOf: BlockWriter = (block) => inlineMarkdown(block).trim()

/** The part a block element inside an item is, or null for one that is not a block of its own. */
function blockPartKind(tag: string): 'list' | 'code' | 'quote' | 'table' | null {
  if (tag === 'ul' || tag === 'ol') {
    return 'list'
  }
  if (tag === 'pre') {
    return 'code'
  }
  if (tag === 'table') {
    return 'table'
  }
  return tag === 'blockquote' ? 'quote' : null
}

/**
 * What an item holds, in order: its paragraphs, code blocks, quotes, tables and nested lists.
 *
 * Words are every inline node outside those blocks, the task box's `<label>` excluded (it is the
 * checkbox's chrome, and the writer supplies the marker). A `<p>` or `<div>` is a paragraph of its
 * own, so a second paragraph is not glued onto the first; one that holds blocks — the task's
 * `<div>`, a `<p>` the engine nested a list in — is walked into. A list inside a nested item is
 * that item's, and is never reached here, and a quote's paragraphs are the quote's.
 *
 * A `<br>` in the words is a hard break, written as a paragraph's is (html-paragraph-markdown.ts);
 * it was a bare newline until 2026-10-01, and the line after it was written at the margin, so
 * '- a  \n  b' saved as '- a\nb', one item reading 'a b'. itemMarkdown puts each later line at
 * the item's indent.
 */
function itemParts(item: Element): ItemPart[] {
  const parts: ItemPart[] = []
  const lineBreak = { lineBreak: () => breakMark() }
  let run = ''
  const flush = () => {
    const words = markedBreaksMarkdown(run, [])
    if (words) {
      parts.push({ kind: 'words', words, element: null })
    }
    run = ''
  }
  const walk = (container: Element) => {
    for (const child of Array.from(container.childNodes)) {
      if (!(child instanceof Element)) {
        run += inlineMarkdown(child, lineBreak)
        continue
      }
      const tag = child.tagName.toLowerCase()
      if (tag === 'label') {
        continue
      }
      const block = blockPartKind(tag)
      if (block !== null) {
        flush()
        parts.push({ kind: block, element: child })
        continue
      }
      const paragraph = tag === 'p' || tag === 'div'
      if (paragraph) {
        flush()
      }
      if (child.querySelector('ul, ol, pre, blockquote, table, p, div') !== null) {
        walk(child)
      } else if (paragraph) {
        parts.push({ kind: 'words', words: paragraphMarkdown(child), element: child })
      } else {
        run += inlineMarkdown(child, lineBreak)
      }
      if (paragraph) {
        flush()
      }
    }
  }
  walk(item)
  flush()
  return parts.filter((part) => part.kind !== 'words' || part.words !== '')
}

/**
 * The columns a nested item, or an item's later paragraph, goes in from the line of the item that
 * holds it: where its source put it (LIST_INDENT_ATTRIBUTE, markdown-list-render.ts), or else
 * `fallback`, the marker's width, which is where CommonMark needs it to be.
 */
function remembered(element: Element | null, fallback: number): number {
  const value = Number.parseInt(element?.getAttribute(LIST_INDENT_ATTRIBUTE) ?? '', 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * Whether an element carries a list that no list item owns, and so is a block of its own.
 *
 * The mirror of an item's own lists (`itemParts`): a list under an `li` is that item's, serialized
 * at its own indentation, and any other list is a block wherever the engine put it — including
 * inside a `<p>`.
 */
export function holdsUnownedList(element: Element): boolean {
  return Array.from(element.querySelectorAll('ul, ol')).some((list) => list.closest('li') === null)
}

/**
 * The block an item with no words before it opens on its marker line, written at the margin: a
 * fence nothing moved elsewhere, as `- ```` does, a quote, as `- > a` does, or a table. Null for
 * anything else, which goes under an empty marker.
 */
function markerLineMarkdown(part: ItemPart | undefined, writeBlock: BlockWriter): string | null {
  if (
    part?.kind === 'code' &&
    !part.element.hasAttribute(CODE_INDENT_ATTRIBUTE) &&
    !part.element.hasAttribute(INDENTED_CODE_ATTRIBUTE)
  ) {
    return codeBlockMarkdown(part.element, 0, 0, false)
  }
  return part?.kind === 'quote' || part?.kind === 'table' ? writeBlock(part.element) : null
}

/** Whether a first line would be read as a row of a table above it: one with a pipe. */
function readsAsRow(written: string): boolean {
  return (written.split('\n')[0] ?? '').includes('|')
}

/**
 * Whether a later paragraph goes straight under the block before it, as its source wrote it
 * (ITEM_TIGHT_ATTRIBUTE): after a code block, after a quote when its words would not be read as
 * more of the quote, after a table when they would not be read as a row. Without a blank line
 * after words it would be the same paragraph.
 */
function followsTight(previous: ItemPart['kind'] | null, part: ItemPart & { kind: 'words' }) {
  return (
    part.element?.hasAttribute(ITEM_TIGHT_ATTRIBUTE) === true &&
    (previous === 'code' ||
      (previous === 'quote' && !part.words.startsWith('>')) ||
      (previous === 'table' && !readsAsRow(part.words)))
  )
}

/**
 * Whether a quote or a table goes under a blank line: where its source had one
 * (CODE_BLANK_ATTRIBUTE), and where the block before would take its first line in — a quote after
 * a quote, a table after a table, a quote whose first line has a pipe after a table (a row), and a
 * table after a nested list, whose last item's words would take its header.
 */
function blankBeforeBlock(
  part: ItemPart & { kind: 'quote' | 'table' },
  previous: ItemPart['kind'] | null,
  written: string
): boolean {
  if (part.element.hasAttribute(CODE_BLANK_ATTRIBUTE) || previous === part.kind) {
    return true
  }
  return part.kind === 'table' ? previous === 'list' : previous === 'table' && readsAsRow(written)
}

/**
 * One item as its lines: the marker and its first paragraph at `column`, then its paragraphs, code
 * blocks, quotes, tables and nested lists in order, each from the item's line by the marker's
 * width unless its source put it elsewhere. A later paragraph has a blank line before it (without
 * one it would be the words before it), except straight after a block where its source had none.
 * A quote or a table has one where its source did, or where it would join the block before
 * (blankBeforeBlock). A code block, a quote or a table with no words before it opens on the marker
 * line.
 */
function itemMarkdown(
  item: Element,
  column: number,
  marker: string,
  markerColumns: number,
  writeBlock: BlockWriter
) {
  const parts = itemParts(item)
  const lines: string[] = []
  const first = parts[0]
  let rest = parts.slice(1)
  const opening = markerLineMarkdown(first, writeBlock)
  if (first?.kind === 'words') {
    // The words' later lines, after a hard break, at the item's indent: at the margin they are a
    // lazy line, and the break before one is read as no break by every reader but CommonMark's.
    const [head = '', ...more] = first.words.split('\n')
    const content = ' '.repeat(column + markerColumns)
    lines.push(' '.repeat(column) + marker + head)
    lines.push(...more.map((line) => (line ? content + line : line)))
  } else if (opening !== null) {
    const [head, ...body] = opening.split('\n')
    const content = ' '.repeat(column + markerColumns)
    lines.push(' '.repeat(column) + marker + head)
    lines.push(...body.map((line) => (line ? content + line : line)))
  } else {
    lines.push(' '.repeat(column) + marker)
    rest = parts
  }
  let previous = rest === parts ? null : (first?.kind ?? null)
  for (const part of rest) {
    if (part.kind === 'list') {
      const nested = listMarkdown(part.element, column, markerColumns, writeBlock)
      if (nested) {
        lines.push(nested)
      }
    } else if (part.kind === 'quote' || part.kind === 'table') {
      const written = writeBlock(part.element)
      if (blankBeforeBlock(part, previous, written)) {
        lines.push('')
      }
      const pad = ' '.repeat(column + remembered(part.element, markerColumns))
      lines.push(...written.split('\n').map((line) => (line ? pad + line : line)))
    } else if (part.kind === 'code') {
      const indentable = previous !== 'list'
      if (writesIndented(part.element, indentable) || part.element.hasAttribute(CODE_BLANK_ATTRIBUTE)) {
        lines.push('')
      }
      lines.push(codeBlockMarkdown(part.element, column, markerColumns, indentable))
    } else {
      if (!followsTight(previous, part)) {
        lines.push('')
      }
      const pad = ' '.repeat(column + remembered(part.element, markerColumns))
      lines.push(...part.words.split('\n').map((line) => (line ? pad + line : line)))
    }
    previous = part.kind
  }
  return lines.join('\n')
}

/**
 * A list element as markdown. A top-level list (no `parentMarkerColumns`) starts at `column`; a
 * nested one goes in from its parent's line at `column` by the parent's marker width: `1. ` is 3,
 * `10. ` is 4, a bullet or a task 2. It was two spaces a level whatever the marker until
 * 2026-09-30, so '1. a\n   - b\n2. c' saved as '1. a\n  - b\n2. c', and to CommonMark and GitHub
 * `b` then ended the ordered list and split it in two.
 *
 * An ordered item's own number is preferred over its position, because the browser renumbers a
 * pasted or split item in the markup, and the source has to say what the surface shows. The `)`
 * its source wrote after it is kept (LIST_DELIMITER_ATTRIBUTE); every number was written with `.`
 * until 2026-09-30. A numbered task list is the task list's markup with its first number on it
 * (ORDERED_TASK_ATTRIBUTE), and is written numbered, box and all: '1. [ ] a'.
 *
 * `writeBlock` writes an item's quote or table (BlockWriter); html-block-markdown.ts always passes
 * one.
 */
export function listMarkdown(
  element: Element,
  column: number,
  parentMarkerColumns: number | null = null,
  writeBlock: BlockWriter = wordsOf
): string {
  const tag = element.tagName.toLowerCase()
  const isTask = element.getAttribute('data-type') === 'taskList'
  const orderedTask = isTask ? element.getAttribute(ORDERED_TASK_ATTRIBUTE) : null
  const ordered = tag === 'ol' || orderedTask !== null
  const parsedStart = Number.parseInt(
    (tag === 'ol' ? element.getAttribute('start') : orderedTask) ?? '1',
    10
  )
  const orderedStart = Number.isFinite(parsedStart) ? parsedStart : 1
  return Array.from(element.children)
    .map((item, index) => {
      if (item.tagName.toLowerCase() !== 'li') {
        return ''
      }
      // `||` rather than `??`: an empty attribute is no number, and the next source answers.
      const listNumber = item.getAttribute('data-list-number') || item.getAttribute('value')
      const delimiter = item.getAttribute(LIST_DELIMITER_ATTRIBUTE) === ')' ? ')' : '.'
      const bullet = ordered ? `${listNumber || orderedStart + index}${delimiter} ` : '- '
      const input = isTask ? item.querySelector<HTMLInputElement>('input[type="checkbox"]') : null
      const marker = isTask ? `${bullet}[${input && input.checked ? 'x' : ' '}] ` : bullet
      // A task's box is its words, so its children go where its marker's would without one.
      const markerColumns = bullet.length
      const itemColumn =
        parentMarkerColumns === null ? column : column + remembered(item, parentMarkerColumns)
      const written = itemMarkdown(item, itemColumn, marker, markerColumns, writeBlock)
      // A loose sublist keeps the blank line above it (ITEM_BLANK_ATTRIBUTE), but a list at the
      // margin opens on its first item, with nothing above it in the list.
      const blank =
        item.hasAttribute(ITEM_BLANK_ATTRIBUTE) && (index > 0 || parentMarkerColumns !== null)
      return blank ? `\n${written}` : written
    })
    .filter(Boolean)
    .join('\n')
}
