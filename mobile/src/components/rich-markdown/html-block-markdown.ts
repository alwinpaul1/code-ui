import { codeBlockMarkdown } from './html-code-block-markdown'
import { openingFence } from './markdown-code-fence'
import { VERBATIM_ATTRIBUTE } from './markdown-front-matter'
import { SETEXT_ATTRIBUTE, setextLevel } from './markdown-leaf-blocks'
import { isBlockStart } from './markdown-to-html'
import {
  escapeTableCell,
  TABLE_BARE_ATTRIBUTE,
  TABLE_SEPARATOR_ATTRIBUTE,
  tableMarkdown
} from './markdown-table-rows'
import { inlineChildren, inlineMarkdown, textContent } from './html-inline-markdown'
import { holdsUnownedList, listMarkdown } from './html-list-markdown'
import { paragraphMarkdown } from './html-paragraph-markdown'
import { QUOTE_TIGHT_ATTRIBUTE, quoteLineContent } from './markdown-quote'

/** An element that is a block of its own wherever the engine puts it. */
function isBlockElement(node: Node): node is Element {
  return (
    node instanceof Element &&
    /^(p|div|h[1-6]|pre|ul|ol|blockquote|table|hr)$/i.test(node.tagName)
  )
}

/** One block of a container as written, and the element it was written from (none for bare text). */
type ContainerPart = { text: string; element: Element | null }

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
function containerParts(element: Element): ContainerPart[] {
  const parts: ContainerPart[] = []
  let inline = ''
  const flushInline = () => {
    if (inline.trim()) {
      parts.push({ text: inline.trim(), element: null })
    }
    inline = ''
  }
  for (const child of Array.from(element.childNodes)) {
    if (isBlockElement(child)) {
      flushInline()
      parts.push({ text: blockMarkdown(child), element: child })
      continue
    }
    if (child instanceof Element && holdsUnownedList(child)) {
      flushInline()
      parts.push(...containerParts(child))
      continue
    }
    inline += inlineMarkdown(child)
  }
  flushInline()
  return parts.filter((part) => part.text.trim().length > 0)
}

/** Whether a paragraph holds blocks rather than only words: a list the engine nested, a `<p>`. */
function holdsBlocks(element: Element): boolean {
  return holdsUnownedList(element) || Array.from(element.childNodes).some(isBlockElement)
}

/** What a block of a quote is, as far as the blank line before or after it matters. */
type QuotePartKind = 'words' | 'fenced' | 'indented' | 'quote' | 'other'

function quotePartKind(part: ContainerPart): QuotePartKind {
  const tag = part.element?.tagName.toLowerCase() ?? 'p'
  if (tag === 'p' || tag === 'div') {
    return part.element !== null && holdsBlocks(part.element) ? 'other' : 'words'
  }
  if (tag === 'pre') {
    return openingFence(part.text.split('\n')[0] ?? '') === null ? 'indented' : 'fenced'
  }
  return tag === 'blockquote' ? 'quote' : 'other'
}

/**
 * Whether two blocks of a quote written with no blank quote line between them are read back as the
 * same two (markdown-quote.ts): a fence opens and closes itself, and a nested quote is its marked
 * lines. Two paragraphs, two indented code blocks, two quotes, or code four columns in under words,
 * would be read as one, and words that open a fence or a quote would not be words.
 */
function readsApartWithNoBlank(before: QuotePartKind, after: QuotePartKind, text: string): boolean {
  const first = text.split('\n')[0] ?? ''
  if (before === 'other' || after === 'other') {
    return false
  }
  if (after === 'words' && (openingFence(first) !== null || quoteLineContent(first) !== null)) {
    return false
  }
  if (before === 'fenced' || after === 'fenced') {
    return true
  }
  if (before === 'quote' || after === 'quote') {
    return before !== after
  }
  return before === 'indented' && after === 'words'
}

/**
 * A quote as its blocks, each line marked, and a bare `>` between blocks rather than `> ` — except
 * where the source had none (QUOTE_TIGHT_ATTRIBUTE) and the two blocks read back apart without one.
 * A code line of spaces keeps them; any other line that is only spaces is a bare `>`.
 */
function quoteMarkdown(quote: Element): string {
  const parts = containerParts(quote)
  if (parts.length === 0) {
    return '>'
  }
  const lines: string[] = []
  parts.forEach((part, index) => {
    const kind = quotePartKind(part)
    const before = parts[index - 1]
    if (
      before !== undefined &&
      !(
        part.element?.hasAttribute(QUOTE_TIGHT_ATTRIBUTE) &&
        readsApartWithNoBlank(quotePartKind(before), kind, part.text)
      )
    ) {
      lines.push('>')
    }
    const code = kind === 'fenced' || kind === 'indented'
    for (const line of part.text.split('\n')) {
      lines.push((code ? line : line.trim()) ? `> ${line}` : '>')
    }
  })
  return lines.join('\n')
}

/**
 * A heading, under the underline its source wrote it with (SETEXT_ATTRIBUTE) while one can still
 * write it: level 1 or 2 as the underline says, and words on one line that would not read as a
 * block of their own. Otherwise with hashes, as every heading was written before 2026-09-30.
 */
function headingMarkdown(heading: Element, level: number): string {
  const words = inlineChildren(heading).trim()
  const underline = heading.getAttribute(SETEXT_ATTRIBUTE)
  if (
    underline !== null &&
    setextLevel(underline) === level &&
    words &&
    !words.includes('\n') &&
    !isBlockStart(words) &&
    setextLevel(words) === null
  ) {
    return `${words}\n${underline}`
  }
  return `${'#'.repeat(level)} ${words}`
}

/**
 * Whether the block before this one, blank ones skipped, is a list: an indented code block there
 * would be read as the last item's paragraph, so it is fenced instead.
 */
function followsList(node: Element): boolean {
  let previous = node.previousElementSibling
  while (previous !== null && !blockMarkdown(previous).trim()) {
    previous = previous.previousElementSibling
  }
  return previous !== null && /^(ul|ol)$/i.test(previous.tagName)
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
    return headingMarkdown(node, Number(tag.slice(1)))
  }
  if (tag === 'p' || tag === 'div') {
    if (holdsBlocks(node)) {
      return containerParts(node)
        .map((part) => part.text)
        .join('\n\n')
    }
    // A quote draws every source line as a break (markdown-to-html.ts), so its breaks are lines.
    return node.closest('blockquote') === null
      ? paragraphMarkdown(node)
      : inlineChildren(node).trim()
  }
  if (tag === 'blockquote') {
    return quoteMarkdown(node)
  }
  if (tag === 'pre') {
    // Raw text, not `textContent()`: a verbatim block is written back byte for byte, a no-break
    // space included.
    return node.hasAttribute(VERBATIM_ATTRIBUTE)
      ? (node.textContent ?? '')
      : codeBlockMarkdown(node, 0, 0, !followsList(node))
  }
  if (tag === 'ul' || tag === 'ol') {
    return listMarkdown(node, 0, null, blockMarkdown)
  }
  if (tag === 'table') {
    const rows = Array.from(node.querySelectorAll('tr'))
    if (rows.length === 0) {
      return ''
    }
    // A cell's break is a space: a newline would end the row, and the table with it.
    const cellsFor = (row: Element) =>
      Array.from(row.children).map((cell) =>
        escapeTableCell(inlineChildren(cell, { lineBreak: () => ' ' }).trim())
      )
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
