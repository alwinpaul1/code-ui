import { inlineMarkdown } from './html-inline-markdown'
import { codeBlockMarkdown } from './html-code-block-markdown'
import { CODE_BLANK_ATTRIBUTE } from './markdown-code-fence'
import { LIST_INDENT_ATTRIBUTE } from './markdown-list-render'

/** What an item holds besides its words: a nested list or a code block, each on its own lines. */
type ItemBlockElement = { kind: 'list' | 'code'; element: Element }

/**
 * An item's words, and the lists and code blocks it holds, in order.
 *
 * The words are every inline node outside those blocks, the task box's `<label>` excluded (it is
 * the checkbox's chrome, and the writer supplies the marker). An element that holds a block — the
 * task's `<div>`, a `<p>` the engine nested a list in — is walked into rather than read as words.
 * A list inside a nested item is that item's, and is never reached here.
 */
function itemContent(item: Element): { words: string; blocks: ItemBlockElement[] } {
  const blocks: ItemBlockElement[] = []
  let words = ''
  const walk = (container: Element) => {
    for (const child of Array.from(container.childNodes)) {
      if (!(child instanceof Element)) {
        words += inlineMarkdown(child)
        continue
      }
      const tag = child.tagName.toLowerCase()
      if (tag === 'label') {
        continue
      }
      if (tag === 'ul' || tag === 'ol' || tag === 'pre') {
        blocks.push({ kind: tag === 'pre' ? 'code' : 'list', element: child })
        continue
      }
      if (child.querySelector('ul, ol, pre') !== null) {
        walk(child)
        continue
      }
      words += inlineMarkdown(child)
    }
  }
  walk(item)
  return { words: words.trim(), blocks }
}

/**
 * Whether an element carries a list that no list item owns, and so is a block of its own.
 *
 * The mirror of an item's own lists (`itemContent`): a list under an `li` is that item's, serialized
 * at its own indentation, and any other list is a block wherever the engine put it — including
 * inside a `<p>`.
 */
export function holdsUnownedList(element: Element): boolean {
  return Array.from(element.querySelectorAll('ul, ol')).some((list) => list.closest('li') === null)
}

/**
 * The columns a nested item goes in from its parent's line: where its source put it
 * (LIST_INDENT_ATTRIBUTE, markdown-list-render.ts), or else the parent's marker width, which is
 * where CommonMark needs a child to be.
 */
function childColumns(item: Element, parentMarkerColumns: number): number {
  const remembered = Number.parseInt(item.getAttribute(LIST_INDENT_ATTRIBUTE) ?? '', 10)
  return Number.isFinite(remembered) && remembered > 0 ? remembered : parentMarkerColumns
}

/**
 * One item as its lines: the marker and its words at `column`, then its code blocks and nested
 * lists in order, each from the item's line by the marker's width unless its source put it
 * elsewhere. A code block with no words before it opens on the marker line, as `- ```` does, and
 * its lines go at the marker's width.
 */
function itemMarkdown(item: Element, column: number, marker: string, markerColumns: number) {
  const { words, blocks } = itemContent(item)
  const lines: string[] = []
  let rest = blocks
  const first = blocks[0]
  if (words === '' && first?.kind === 'code') {
    const [fenceLine, ...body] = codeBlockMarkdown(first.element).split('\n')
    const content = ' '.repeat(column + markerColumns)
    lines.push(' '.repeat(column) + marker + fenceLine, ...body.map((line) => (line ? content + line : line)))
    rest = blocks.slice(1)
  } else {
    lines.push(' '.repeat(column) + marker + words)
  }
  for (const block of rest) {
    if (block.kind === 'list') {
      const nested = listMarkdown(block.element, column, markerColumns)
      if (nested) {
        lines.push(nested)
      }
      continue
    }
    if (block.element.hasAttribute(CODE_BLANK_ATTRIBUTE)) {
      lines.push('')
    }
    lines.push(codeBlockMarkdown(block.element, column, markerColumns))
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
        parentMarkerColumns === null ? column : column + childColumns(item, parentMarkerColumns)
      return itemMarkdown(item, itemColumn, marker, markerColumns)
    })
    .filter(Boolean)
    .join('\n')
}
