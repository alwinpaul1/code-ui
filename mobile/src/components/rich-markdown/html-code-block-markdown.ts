import {
  CODE_FENCE_ATTRIBUTE,
  CODE_INDENT_ATTRIBUTE,
  CODE_INFO_ATTRIBUTE,
  writtenFence
} from './markdown-code-fence'
import { textContent } from './html-inline-markdown'

/** The columns a remembered attribute names, or `fallback` when it names none. */
export function rememberedColumns(element: Element, attribute: string, fallback: number): number {
  const value = Number.parseInt(element.getAttribute(attribute) ?? '', 10)
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

/**
 * A `<pre>` as a fenced block, written the way its source wrote it where the renderer remembered
 * that (markdown-code-fence.ts): its whole info string, tildes or a longer run, and its indent,
 * which every line of the block but a blank one is written at.
 *
 * `indent` is the columns the block's container puts it at, which the block's own remembered
 * indent is added to: a top-level fence three columns in, or a fence under a list item.
 */
export function codeBlockMarkdown(pre: Element, indent = 0): string {
  const info = pre.getAttribute(CODE_INFO_ATTRIBUTE) ?? pre.getAttribute('data-language') ?? ''
  const code = textContent(pre.querySelector('code') ?? pre).replace(/\n+$/g, '')
  const fence = writtenFence(code, pre.getAttribute(CODE_FENCE_ATTRIBUTE), info)
  const columns = ' '.repeat(indent + rememberedColumns(pre, CODE_INDENT_ATTRIBUTE, 0))
  return [`${fence}${info}`, ...code.split('\n'), fence]
    .map((line) => (line ? columns + line : line))
    .join('\n')
}
