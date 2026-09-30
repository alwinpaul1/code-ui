import { AUTOLINK_ATTRIBUTE } from './markdown-inline-render'
import { ENTITY_SOURCE_ATTRIBUTE, entitySourceWriter } from './markdown-entity-source'

/** A node's text with non-breaking spaces turned back into the spaces the source wrote. */
export function textContent(node: Node): string {
  return (node.textContent ?? '').replace(/ /g, ' ')
}

/**
 * How the nodes under an element are written where something above them decides: a text node
 * under a run the renderer drew from entities is written from its source
 * (markdown-entity-source.ts).
 */
export type InlineContext = {
  text?: (node: Node) => string
}

/** A run the renderer drew from entities, written back from its source where it still can be. */
function entityRunMarkdown(run: Element, context: InlineContext): string {
  const text = entitySourceWriter(run, (value) => value.replace(/ /g, ' '))
  return inlineChildren(run, text === null ? context : { ...context, text })
}

/**
 * One node of the editable surface as inline markdown.
 *
 * A task item's `<label>` is the checkbox's chrome rather than content, so it serializes to
 * nothing and the list writer supplies the marker instead.
 */
export function inlineMarkdown(node: Node | null | undefined, context: InlineContext = {}): string {
  if (!node) {
    return ''
  }
  if (node.nodeType === Node.TEXT_NODE) {
    return context.text?.(node) ?? textContent(node)
  }
  if (!(node instanceof Element)) {
    return ''
  }
  const tag = node.tagName.toLowerCase()
  if (tag === 'br') {
    return '\n'
  }
  if (tag === 'strong' || tag === 'b') {
    return markedMarkdown(node, '**', context)
  }
  if (tag === 'em' || tag === 'i') {
    return markedMarkdown(node, '*', context)
  }
  if (tag === 's' || tag === 'del' || tag === 'strike') {
    return markedMarkdown(node, '~~', context)
  }
  if (tag === 'code' && node.parentElement && node.parentElement.tagName.toLowerCase() !== 'pre') {
    return `\`${textContent(node)}\``
  }
  if (tag === 'a') {
    const href = node.getAttribute('href') ?? ''
    const words = inlineChildren(node, context)
    return autolinkMarkdown(node, href, words) ?? `[${words}](${href})`
  }
  if (tag === 'img') {
    return `![${node.getAttribute('alt') ?? ''}](${node.getAttribute('src') ?? ''})`
  }
  if (tag === 'label') {
    return ''
  }
  if (node.hasAttribute(ENTITY_SOURCE_ATTRIBUTE)) {
    return entityRunMarkdown(node, context)
  }
  return inlineChildren(node, context)
}

/**
 * Bold, italic or strike as its marks around its words, with the whitespace at its edges outside
 * the marks, and nothing at all for a mark with no words.
 *
 * A selection the user marks often takes a space in, and `**word **` or `* word*` is no emphasis
 * in CommonMark: the desktop, the chat and the phone's own reload showed the stars (review,
 * 2026-09-30). A mark the engine left empty saved as `****`, which alone on a line is a rule.
 */
function markedMarkdown(node: Element, marks: string, context: InlineContext): string {
  const inner = inlineChildren(node, context)
  const words = inner.trim()
  if (!words) {
    return inner
  }
  const lead = inner.slice(0, inner.length - inner.trimStart().length)
  const trail = inner.slice(inner.trimEnd().length)
  return `${lead}${marks}${words}${marks}${trail}`
}

/**
 * An address the renderer drew from an autolink (AUTOLINK_ATTRIBUTE), written back the way the
 * source wrote it: bare, or in its angle brackets. Every `<a>` was written `[words](href)`, so
 * opening a document and saving it turned each bare address into `[address](address)` (review,
 * 2026-09-30).
 *
 * Only while its words still spell what it opens. Words the user retitled, or marked bold, would
 * be lost or would open somewhere else as an autolink, so that link is written out in full. A
 * link with no mark, the toolbar's or a `[words](href)` in the source, stays explicit even when
 * its words are its address.
 */
function autolinkMarkdown(node: Element, href: string, words: string): string | null {
  const written = node.getAttribute(AUTOLINK_ATTRIBUTE)
  if (written === 'bare' && words === href) {
    return words
  }
  if (written === 'angle' && (words === href || `mailto:${words}` === href)) {
    return `<${words}>`
  }
  return null
}

export function inlineChildren(element: Element, context: InlineContext = {}): string {
  return Array.from(element.childNodes)
    .map((child) => inlineMarkdown(child, context))
    .join('')
}
