import { escapeLiteralHtml } from './markdown-escaping'
import { CODE_INDENT_ATTRIBUTE } from './markdown-code-fence'

/**
 * Two CommonMark leaf blocks the editor did not know until 2026-09-30, and rewrote on every save:
 * a setext heading ('Title\n=====' saved as 'Title ====='), and an indented code block
 * ('    code line' saved as 'code line', a paragraph).
 */

/** The attribute that keeps a setext heading's underline, so a save writes it under its words. */
export const SETEXT_ATTRIBUTE = 'data-md-setext'
/** The attribute that says a code block was written four columns in rather than fenced. */
export const INDENTED_CODE_ATTRIBUTE = 'data-md-indented'

/** The level a setext underline gives the paragraph above it, or null for any other line. */
export function setextLevel(line: string): 1 | 2 | null {
  const match = line.match(/^ {0,3}(=+|-+)[ \t]*$/)
  if (!match) {
    return null
  }
  return match[1]!.startsWith('=') ? 1 : 2
}

/** The columns a line's leading whitespace spans, a tab as four. */
function leadingColumns(line: string): number {
  return (line.match(/^[ \t]*/)?.[0] ?? '').replace(/\t/g, '    ').length
}

/** A line with `columns` of its leading whitespace taken off; a blank line is left empty. */
function outdentColumns(line: string, columns: number): string {
  if (!line.trim()) {
    return ''
  }
  let taken = 0
  let cut = 0
  while (taken < columns && (line[cut] === ' ' || line[cut] === '\t')) {
    taken += line[cut] === '\t' ? 4 : 1
    cut += 1
  }
  return ' '.repeat(Math.max(0, taken - columns)) + line.slice(cut)
}

/**
 * An indented code block from `index`, whose container's words start at `column`: its lines four
 * columns past that, and the blank lines between them, not after them. Null when the line at
 * `index` is not one.
 */
export function readIndentedCode(
  lines: readonly string[],
  index: number,
  column: number
): { code: string; nextIndex: number } | null {
  const first = lines[index] ?? ''
  if (!first.trim() || leadingColumns(first) < column + 4) {
    return null
  }
  let end = index + 1
  for (let next = index + 1; next < lines.length; next += 1) {
    const line = lines[next] ?? ''
    if (!line.trim()) {
      continue
    }
    if (leadingColumns(line) < column + 4) {
      break
    }
    end = next + 1
  }
  const code = lines
    .slice(index, end)
    .map((line) => outdentColumns(line, column + 4))
    .join('\n')
  return { code, nextIndex: end }
}

/**
 * An indented code block as markup: its code exactly as written, entities and marks unread, as
 * CommonMark reads code. `columns` is where it sat from its list item's line, where the writer
 * would not put it.
 */
export function indentedCodeHtml(code: string, columns: number | null = null): string {
  const indent = columns === null ? '' : ` ${CODE_INDENT_ATTRIBUTE}="${columns}"`
  return (
    `<pre data-language="" ${INDENTED_CODE_ATTRIBUTE}="true"${indent}>` +
    `<code>${escapeLiteralHtml(code)}</code></pre>`
  )
}

/** A setext heading as markup, keeping its underline as written, trailing spaces off. */
export function setextHeadingHtml(wordsHtml: string, underline: string): string {
  const level = setextLevel(underline) ?? 2
  return `<h${level} ${SETEXT_ATTRIBUTE}="${underline.trimEnd()}">${wordsHtml}</h${level}>`
}
