import { AUTOLINK_ATTRIBUTE } from './markdown-inline-render'

/** A node's text with non-breaking spaces turned back into the spaces the source wrote. */
export function textContent(node: Node): string {
  return (node.textContent ?? '').replace(/ /g, ' ')
}

/**
 * One node of the editable surface as inline markdown.
 *
 * A task item's `<label>` is the checkbox's chrome rather than content, so it serializes to
 * nothing and the list writer supplies the marker instead.
 */
export function inlineMarkdown(node: Node | null | undefined): string {
  if (!node) {
    return ''
  }
  if (node.nodeType === Node.TEXT_NODE) {
    return textContent(node)
  }
  if (!(node instanceof Element)) {
    return ''
  }
  const tag = node.tagName.toLowerCase()
  if (tag === 'br') {
    return '\n'
  }
  if (tag === 'strong' || tag === 'b') {
    return `**${inlineChildren(node)}**`
  }
  if (tag === 'em' || tag === 'i') {
    return `*${inlineChildren(node)}*`
  }
  if (tag === 's' || tag === 'del' || tag === 'strike') {
    return `~~${inlineChildren(node)}~~`
  }
  if (tag === 'code' && node.parentElement && node.parentElement.tagName.toLowerCase() !== 'pre') {
    return `\`${textContent(node)}\``
  }
  if (tag === 'a') {
    const href = node.getAttribute('href') ?? ''
    const words = inlineChildren(node)
    return autolinkMarkdown(node, href, words) ?? `[${words}](${href})`
  }
  if (tag === 'img') {
    return `![${node.getAttribute('alt') ?? ''}](${node.getAttribute('src') ?? ''})`
  }
  if (tag === 'label') {
    return ''
  }
  return inlineChildren(node)
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

export function inlineChildren(element: Element): string {
  return Array.from(element.childNodes)
    .map((child) => inlineMarkdown(child))
    .join('')
}
