import { codeBlockMarkdown } from './html-code-block-markdown'
import { VERBATIM_ATTRIBUTE } from './markdown-front-matter'
import {
  escapeTableCell,
  TABLE_BARE_ATTRIBUTE,
  TABLE_SEPARATOR_ATTRIBUTE,
  tableMarkdown
} from './markdown-table-rows'
import { inlineChildren, inlineMarkdown, textContent } from './html-inline-markdown'
import { holdsUnownedList, listMarkdown } from './html-list-markdown'

/** An element that is a block of its own wherever the engine puts it. */
function isBlockElement(node: Node): node is Element {
  return (
    node instanceof Element &&
    /^(p|div|h[1-6]|pre|ul|ol|blockquote|table|hr)$/i.test(node.tagName)
  )
}

/**
 * An element that holds blocks, as the blocks it really holds: a run of text, a list, a paragraph,
 * each its own block, in order.
 *
 * `insertUnorderedList` nests the `<ul>` inside the `<p>` it was given rather than replacing it —
 * measured on WebKit 26.4 and Chromium 147 both — and reading such a paragraph inline gave back its
 * own text with no marker, so a list the user typed did not survive a round trip. Structure decides
 * what a list is; the DOM is left as the engine made it. Enter inside a quote makes a second `<p>`
 * or `<div>` inside it, and reading the quote inline glued the two paragraphs' words together
 * (review, 2026-09-30), so every block element counts, not only a list.
 */
function containerBlocks(element: Element): string[] {
  const blocks: string[] = []
  let inline = ''
  const flushInline = () => {
    if (inline.trim()) {
      blocks.push(inline.trim())
    }
    inline = ''
  }
  for (const child of Array.from(element.childNodes)) {
    if (isBlockElement(child)) {
      flushInline()
      blocks.push(blockMarkdown(child))
      continue
    }
    if (child instanceof Element && holdsUnownedList(child)) {
      flushInline()
      blocks.push(...containerBlocks(child))
      continue
    }
    inline += inlineMarkdown(child)
  }
  flushInline()
  return blocks.filter((block) => block.trim().length > 0)
}

/** Whether a paragraph holds blocks rather than only words: a list the engine nested, a `<p>`. */
function holdsBlocks(element: Element): boolean {
  return holdsUnownedList(element) || Array.from(element.childNodes).some(isBlockElement)
}

/** A quote as its blocks, each line marked, and a bare `>` between blocks rather than `> `. */
function quoteMarkdown(quote: Element): string {
  const inner = containerBlocks(quote).join('\n\n')
  if (!inner) {
    return '>'
  }
  return inner
    .split('\n')
    .map((line) => (line.trim() ? `> ${line}` : '>'))
    .join('\n')
}

/**
 * One top-level node of the editable surface as a markdown block.
 *
 * Anything with no block of its own — a stray `div`, an element the browser inserted — serializes
 * as its inline content, so an edit never loses text to a tag this reader does not know.
 */
export function blockMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return textContent(node).trim()
  }
  if (!(node instanceof Element)) {
    return ''
  }
  const tag = node.tagName.toLowerCase()
  if (/^h[1-6]$/.test(tag)) {
    return `${'#'.repeat(Number(tag.slice(1)))} ${inlineChildren(node).trim()}`
  }
  if (tag === 'p' || tag === 'div') {
    return holdsBlocks(node) ? containerBlocks(node).join('\n\n') : inlineChildren(node).trim()
  }
  if (tag === 'blockquote') {
    return quoteMarkdown(node)
  }
  if (tag === 'pre') {
    // Raw text, not `textContent()`: a verbatim block is written back byte for byte, a no-break
    // space included.
    return node.hasAttribute(VERBATIM_ATTRIBUTE) ? (node.textContent ?? '') : codeBlockMarkdown(node)
  }
  if (tag === 'ul' || tag === 'ol') {
    return listMarkdown(node, 0)
  }
  if (tag === 'table') {
    const rows = Array.from(node.querySelectorAll('tr'))
    if (rows.length === 0) {
      return ''
    }
    const cellsFor = (row: Element) =>
      Array.from(row.children).map((cell) => escapeTableCell(inlineChildren(cell).trim()))
    return tableMarkdown(cellsFor(rows[0]!), rows.slice(1).map(cellsFor), {
      separator: node.getAttribute(TABLE_SEPARATOR_ATTRIBUTE),
      bare: node.getAttribute(TABLE_BARE_ATTRIBUTE) === 'true'
    })
  }
  if (tag === 'hr') {
    return '---'
  }
  if (tag === 'img') {
    return inlineMarkdown(node)
  }
  return inlineChildren(node).trim()
}
