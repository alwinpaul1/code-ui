import { inlineMarkdown } from './html-inline-markdown'
import { codeBlockMarkdown, writesIndented } from './html-code-block-markdown'
import { CODE_BLANK_ATTRIBUTE, CODE_INDENT_ATTRIBUTE } from './markdown-code-fence'
import { INDENTED_CODE_ATTRIBUTE } from './markdown-leaf-blocks'
import { ITEM_TIGHT_ATTRIBUTE, LIST_INDENT_ATTRIBUTE } from './markdown-list-render'

/** One piece of what an item holds, in order: a paragraph of words, a code block or a list. */
type ItemPart =
  | { kind: 'words'; words: string; element: Element | null }
  | { kind: 'list'; element: Element }
  | { kind: 'code'; element: Element }

/**
 * What an item holds, in order: its paragraphs, code blocks and nested lists.
 *
 * Words are every inline node outside those blocks, the task box's `<label>` excluded (it is the
 * checkbox's chrome, and the writer supplies the marker). A `<p>` or `<div>` is a paragraph of its
 * own, so a second paragraph is not glued onto the first; one that holds blocks — the task's
 * `<div>`, a `<p>` the engine nested a list in — is walked into. A list inside a nested item is
 * that item's, and is never reached here.
 */
function itemParts(item: Element): ItemPart[] {
  const parts: ItemPart[] = []
  let run = ''
  const flush = () => {
    if (run.trim()) {
      parts.push({ kind: 'words', words: run.trim(), element: null })
    }
    run = ''
  }
  const walk = (container: Element) => {
    for (const child of Array.from(container.childNodes)) {
      if (!(child instanceof Element)) {
        run += inlineMarkdown(child)
        continue
      }
      const tag = child.tagName.toLowerCase()
      if (tag === 'label') {
        continue
      }
      if (tag === 'ul' || tag === 'ol' || tag === 'pre') {
        flush()
        parts.push({ kind: tag === 'pre' ? 'code' : 'list', element: child })
        continue
      }
      const paragraph = tag === 'p' || tag === 'div'
      if (paragraph) {
        flush()
      }
      if (child.querySelector('ul, ol, pre, p, div') !== null) {
        walk(child)
      } else if (paragraph) {
        run = inlineMarkdown(child)
        parts.push({ kind: 'words', words: run.trim(), element: child })
        run = ''
      } else {
        run += inlineMarkdown(child)
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

/** Whether a code block can open on its item's marker line: a fence nothing moved elsewhere. */
function opensOnMarkerLine(part: ItemPart | undefined): part is { kind: 'code'; element: Element } {
  return (
    part?.kind === 'code' &&
    !part.element.hasAttribute(CODE_INDENT_ATTRIBUTE) &&
    !part.element.hasAttribute(INDENTED_CODE_ATTRIBUTE)
  )
}

/**
 * One item as its lines: the marker and its first paragraph at `column`, then its paragraphs, code
 * blocks and nested lists in order, each from the item's line by the marker's width unless its
 * source put it elsewhere. A later paragraph has a blank line before it (without one it would be
 * the words before it), except straight after a code block where its source had none. A code block
 * with no words before it opens on the marker line, as `- ```` does.
 */
function itemMarkdown(item: Element, column: number, marker: string, markerColumns: number) {
  const parts = itemParts(item)
  const lines: string[] = []
  const first = parts[0]
  let rest = parts.slice(1)
  if (first?.kind === 'words') {
    lines.push(' '.repeat(column) + marker + first.words)
  } else if (opensOnMarkerLine(first)) {
    const [fenceLine, ...body] = codeBlockMarkdown(first.element, 0, 0, false).split('\n')
    const content = ' '.repeat(column + markerColumns)
    lines.push(' '.repeat(column) + marker + fenceLine)
    lines.push(...body.map((line) => (line ? content + line : line)))
  } else {
    lines.push(' '.repeat(column) + marker)
    rest = parts
  }
  let previous = rest === parts ? null : (first?.kind ?? null)
  for (const part of rest) {
    if (part.kind === 'list') {
      const nested = listMarkdown(part.element, column, markerColumns)
      if (nested) {
        lines.push(nested)
      }
    } else if (part.kind === 'code') {
      const indentable = previous !== 'list'
      if (writesIndented(part.element, indentable) || part.element.hasAttribute(CODE_BLANK_ATTRIBUTE)) {
        lines.push('')
      }
      lines.push(codeBlockMarkdown(part.element, column, markerColumns, indentable))
    } else {
      if (!(previous === 'code' && part.element?.hasAttribute(ITEM_TIGHT_ATTRIBUTE))) {
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
 * pasted or split item in the markup, and the source has to say what the surface shows.
 */
export function listMarkdown(
  element: Element,
  column: number,
  parentMarkerColumns: number | null = null
): string {
  const tag = element.tagName.toLowerCase()
  const isTask = element.getAttribute('data-type') === 'taskList'
  const parsedStart = tag === 'ol' ? Number.parseInt(element.getAttribute('start') ?? '1', 10) : 1
  const orderedStart = Number.isFinite(parsedStart) ? parsedStart : 1
  return Array.from(element.children)
    .map((item, index) => {
      if (item.tagName.toLowerCase() !== 'li') {
        return ''
      }
      let marker: string
      // A task's box is its words, so its children go where a bullet's do.
      let markerColumns = 2
      if (isTask) {
        const input = item.querySelector<HTMLInputElement>('input[type="checkbox"]')
        marker = `- [${input && input.checked ? 'x' : ' '}] `
      } else {
        // `||` rather than `??`: an empty attribute is no number, and the next source answers.
        const listNumber = item.getAttribute('data-list-number') || item.getAttribute('value')
        marker = tag === 'ol' ? `${listNumber || orderedStart + index}. ` : '- '
        markerColumns = marker.length
      }
      const itemColumn =
        parentMarkerColumns === null ? column : column + remembered(item, parentMarkerColumns)
      return itemMarkdown(item, itemColumn, marker, markerColumns)
    })
    .filter(Boolean)
    .join('\n')
}
