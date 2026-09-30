import { inlineChildren } from './html-inline-markdown'
import { LIST_INDENT_ATTRIBUTE } from './markdown-list-render'

/**
 * An item's own text: its label and any nested list taken off first.
 *
 * On a copy, because both belong to the live document — the label carries the checkbox the user
 * ticks, and the nested lists are serialized separately at their own indentation.
 */
export function listItemText(item: Element): string {
  const clone = item.cloneNode(true)
  // `cloneNode` is typed as returning a `Node`; an element's deep copy is an element.
  if (!(clone instanceof Element)) {
    return ''
  }
  clone.querySelectorAll('label').forEach((label) => label.remove())
  clone.querySelectorAll('ul, ol').forEach((list) => list.remove())
  return inlineChildren(clone).trim()
}

/** The lists directly inside an item, rather than every list anywhere beneath it. */
export function directNestedLists(item: Element): Element[] {
  return Array.from(item.querySelectorAll('ul, ol')).filter((list) => list.closest('li') === item)
}

/**
 * Whether an element carries a list that no list item owns, and so is a block of its own.
 *
 * The mirror of `directNestedLists`: a list under an `li` is that item's, serialized at its own
 * indentation, and any other list is a block wherever the engine put it — including inside a `<p>`.
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
      const line = ' '.repeat(itemColumn) + marker + listItemText(item)
      const nested = directNestedLists(item)
        .map((list) => listMarkdown(list, itemColumn, markerColumns))
        .filter(Boolean)
        .join('\n')
      return nested ? `${line}\n${nested}` : line
    })
    .filter(Boolean)
    .join('\n')
}
