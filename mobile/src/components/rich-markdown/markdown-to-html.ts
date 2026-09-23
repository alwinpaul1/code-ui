import { escapeAttr, escapeHtml } from './markdown-escaping'
import { renderInline } from './markdown-inline-render'
import { renderListItems } from './markdown-list-render'
import { parseListTree } from './markdown-list-parse'
import { closesFence, openingFence } from './markdown-code-fence'
import { isTableSeparator, splitTableRow } from './markdown-table-rows'
import type { RichMarkdownEditorScope } from './document-scope'
import { reflowLines } from './markdown-reflow'

/** Whether a line opens a block of its own, which is what ends the paragraph being gathered. */
export function isBlockStart(line: string): boolean {
  return /^(```|#{1,6}\s+|>\s?|\s*(?:[-*+]|\d+[.)])\s+|\s*(-{3,}|\*{3,}|_{3,})\s*$)/.test(line)
}

/**
 * Markdown as the markup the editable surface holds.
 *
 * Block by block rather than by one pass of replacements, because fenced code, tables and lists
 * each consume a run of lines whose length only their own reader knows. An empty source still
 * renders a paragraph, which is what carries the placeholder.
 */
export function markdownToHtml(scope: RichMarkdownEditorScope, markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const html: string[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (!line.trim()) {
      index += 1
      continue
    }
    const fence = openingFence(line)
    if (fence) {
      index += 1
      const code: string[] = []
      while (index < lines.length && !closesFence(lines[index] ?? '', fence.fence)) {
        code.push(lines[index] ?? '')
        index += 1
      }
      if (index < lines.length) {
        index += 1
      }
      html.push(
        `<pre data-language="${escapeAttr(fence.language)}"><code>${escapeHtml(code.join('\n'))}</code></pre>`
      )
      continue
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      html.push('<hr />')
      index += 1
      continue
    }
    if (
      line.includes('|') &&
      index + 1 < lines.length &&
      isTableSeparator(lines[index + 1] ?? '')
    ) {
      const headers = splitTableRow(line)
      index += 2
      const rows: string[][] = []
      while (
        index < lines.length &&
        (lines[index] ?? '').includes('|') &&
        (lines[index] ?? '').trim()
      ) {
        rows.push(splitTableRow(lines[index] ?? ''))
        index += 1
      }
      // As wide as its widest row, not its header: a cell past the header's count is still the
      // file's text, and cutting the table to the header deleted it on the next save (every build
      // before 2026-09-23). The header pads with empty cells, which the writer keeps.
      const width = Math.max(headers.length, ...rows.map((row) => row.length))
      const columns = Array.from({ length: width }, (_, cellIndex) => cellIndex)
      const head = columns.map((cellIndex) => `<th>${renderInline(headers[cellIndex] ?? '')}</th>`).join('')
      const body = rows
        .map(
          (row) =>
            `<tr>${columns.map((cellIndex) => `<td>${renderInline(row[cellIndex] ?? '')}</td>`).join('')}</tr>`
        )
        .join('')
      html.push(`<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`)
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      const level = heading[1]!.length
      html.push(`<h${level}>${renderInline(heading[2]!.trim())}</h${level}>`)
      index += 1
      continue
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index] ?? '')) {
        quote.push((lines[index] ?? '').replace(/^>\s?/, ''))
        index += 1
      }
      html.push(
        `<blockquote><p>${renderInline(quote.join('\n').trim()).replace(/\n/g, '<br />')}</p></blockquote>`
      )
      continue
    }
    if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) {
      const list = parseListTree(lines, index, isBlockStart)
      // Why: a marker with nothing after it parses as no item, so the run is empty and the index
      // has not moved. Falling through rather than continuing makes the line the text it is.
      if (list.nextIndex > index) {
        html.push(renderListItems(scope, list.items))
        index = list.nextIndex
        continue
      }
    }
    const paragraph: string[] = []
    while (
      index < lines.length &&
      (lines[index] ?? '').trim() &&
      !isBlockStart(lines[index] ?? '') &&
      !(
        index + 1 < lines.length &&
        (lines[index] ?? '').includes('|') &&
        isTableSeparator(lines[index + 1] ?? '')
      )
    ) {
      paragraph.push(lines[index] ?? '')
      index += 1
    }
    if (paragraph.length === 0) {
      // Why: a line that opens a block by `isBlockStart` but matches no block reader's own grammar
      // — `# `, `- `, a fence with a backtick in its language — is gathered by nothing, and the
      // loop would read it again forever. It is text.
      paragraph.push(lines[index] ?? '')
      index += 1
    }
    html.push(`<p>${renderInline(reflowLines(paragraph)).replace(/\n/g, '<br />')}</p>`)
  }
  return html.join('\n') || '<p class="is-empty"><br /></p>'
}
