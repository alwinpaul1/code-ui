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
 * `containerColumn` is where its container's line starts: the margin, or a list item's line. The
 * block goes its remembered columns in from there, or `defaultColumns`, which for a list item is
 * its marker's width.
 */
export function codeBlockMarkdown(pre: Element, containerColumn = 0, defaultColumns = 0): string {
  const info = pre.getAttribute(CODE_INFO_ATTRIBUTE) ?? pre.getAttribute('data-language') ?? ''
  const code = textContent(pre.querySelector('code') ?? pre).replace(/\n+$/g, '')
  const fence = writtenFence(code, pre.getAttribute(CODE_FENCE_ATTRIBUTE), info)
  const columns = ' '.repeat(
    containerColumn + rememberedColumns(pre, CODE_INDENT_ATTRIBUTE, defaultColumns)
  )
  return [`${fence}${info}`, ...code.split('\n'), fence]
    .map((line) => (line ? columns + line : line))
    .join('\n')
}
