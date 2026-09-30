import {
  CODE_FENCE_ATTRIBUTE,
  CODE_INDENT_ATTRIBUTE,
  CODE_INFO_ATTRIBUTE,
  writtenFence
} from './markdown-code-fence'
import { textContent } from './html-inline-markdown'
import { INDENTED_CODE_ATTRIBUTE } from './markdown-leaf-blocks'

/** The columns a remembered attribute names, or `fallback` when it names none. */
export function rememberedColumns(element: Element, attribute: string, fallback: number): number {
  const value = Number.parseInt(element.getAttribute(attribute) ?? '', 10)
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

/** A code block's code, without the trailing newlines an engine leaves to hold the caret. */
function preCode(pre: Element): string {
  return textContent(pre.querySelector('code') ?? pre).replace(/\n+$/g, '')
}

/** Whether `codeBlockMarkdown` writes this block four columns in rather than fenced. */
export function writesIndented(pre: Element, indentable: boolean): boolean {
  const lines = preCode(pre).split('\n')
  return (
    indentable &&
    pre.hasAttribute(INDENTED_CODE_ATTRIBUTE) &&
    Boolean(lines[0]!.trim()) &&
    Boolean(lines[lines.length - 1]!.trim())
  )
}

/**
 * A `<pre>` as a fenced block, written the way its source wrote it where the renderer remembered
 * that (markdown-code-fence.ts): its whole info string, tildes or a longer run, and its indent,
 * which every line of the block but a blank one is written at.
 *
 * `containerColumn` is where its container's line starts: the margin, or a list item's line. The
 * block goes its remembered columns in from there, or `defaultColumns`, which for a list item is
 * its marker's width.
 *
 * A block its source indented (INDENTED_CODE_ATTRIBUTE) is written four columns in again, unless
 * `indentable` says the place would not read it as code (after a list, where it would be the last
 * item's), or its code starts or ends with a blank line or is empty, which an indent cannot hold.
 * Then it is fenced, at its container's width rather than its remembered code column.
 */
export function codeBlockMarkdown(
  pre: Element,
  containerColumn = 0,
  defaultColumns = 0,
  indentable = true
): string {
  const code = preCode(pre)
  const lines = code.split('\n')
  const indented = pre.hasAttribute(INDENTED_CODE_ATTRIBUTE)
  if (writesIndented(pre, indentable)) {
    const columns = ' '.repeat(
      containerColumn + rememberedColumns(pre, CODE_INDENT_ATTRIBUTE, defaultColumns + 4)
    )
    return lines.map((line) => (line.trim() ? columns + line : '')).join('\n')
  }
  const info = pre.getAttribute(CODE_INFO_ATTRIBUTE) ?? pre.getAttribute('data-language') ?? ''
  const fence = writtenFence(code, pre.getAttribute(CODE_FENCE_ATTRIBUTE), info)
  const columns = ' '.repeat(
    containerColumn +
      (indented ? defaultColumns : rememberedColumns(pre, CODE_INDENT_ATTRIBUTE, defaultColumns))
  )
  return [`${fence}${info}`, ...lines, fence]
    .map((line) => (line ? columns + line : line))
    .join('\n')
}
