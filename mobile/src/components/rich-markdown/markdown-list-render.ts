import { renderInline } from './markdown-inline-render'
import { listKind, type ParsedListItem } from './markdown-list-parse'
import type { RichMarkdownEditorScope } from './document-scope'

/** The attribute that keeps how many columns in from its parent's line an item was written. */
export const LIST_INDENT_ATTRIBUTE = 'data-md-indent'

/**
 * The columns an item's marker takes, which is where its children and its later blocks go: `1. `
 * is 3, `10. ` is 4, a bullet or a task (whose box is its words) 2. The writer measures its own
 * marker the same way (html-list-markdown.ts), so a child written there needs nothing remembered.
 */
export function listMarkerColumns(ordered: boolean, orderedNumber: number | null): number {
  return ordered && orderedNumber !== null ? `${orderedNumber}. `.length : 2
}

/**
 * The attribute a nested item carries when its source put it somewhere other than its parent's
 * marker width, so a save writes it where it was: four columns under `1. `, or the two a document
 * written with two-space nesting everywhere puts under `1. `. Nothing for a top-level item, which
 * is written at the margin, and nothing where the width is what the writer would use anyway.
 */
function indentAttribute(item: ParsedListItem, parent: ParsedListItem | null): string {
  if (parent === null) {
    return ''
  }
  const offset = item.indent - parent.indent
  return offset === listMarkerColumns(parent.ordered, parent.orderedNumber)
    ? ''
    : ` ${LIST_INDENT_ATTRIBUTE}="${offset}"`
}

/**
 * A parsed list tree as markup, one list element per run of a single kind.
 *
 * A task item's checkbox mirrors the surface's own editability, because a checkbox left enabled
 * under a read-only document is a control the user can move and the document will not record.
 */
export function renderListItems(
  scope: RichMarkdownEditorScope,
  items: ParsedListItem[],
  parent: ParsedListItem | null = null
): string {
  const html: string[] = []
  let index = 0
  while (index < items.length) {
    const kind = listKind(items[index]!)
    const group: ParsedListItem[] = []
    while (index < items.length && listKind(items[index]!) === kind) {
      group.push(items[index]!)
      index += 1
    }
    const tag = kind === 'ol' ? 'ol' : 'ul'
    const attrs =
      kind === 'task'
        ? ' data-type="taskList"'
        : kind === 'ol' && group[0]!.orderedNumber !== null
          ? ` start="${group[0]!.orderedNumber}"`
          : ''
    const rendered = group
      .map((item) => {
        const children = item.children.length ? renderListItems(scope, item.children, item) : ''
        const indent = indentAttribute(item, parent)
        if (kind === 'task') {
          const checked = item.task === true
          return (
            `<li data-checked="${String(checked)}"${indent}><label contenteditable="false">` +
            `<input type="checkbox" ${checked ? 'checked ' : ''}${scope.editable ? '' : 'disabled '}/>` +
            `</label><div><p>${renderInline(item.text)}</p>${children}</div></li>`
          )
        }
        const orderedAttrs =
          kind === 'ol' && item.orderedNumber !== null
            ? ` value="${item.orderedNumber}" data-list-number="${item.orderedNumber}"`
            : ''
        return `<li${orderedAttrs}${indent}><p>${renderInline(item.text)}</p>${children}</li>`
      })
      .join('')
    html.push(`<${tag}${attrs}>${rendered}</${tag}>`)
  }
  return html.join('')
}
