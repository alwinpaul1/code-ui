import { renderInline } from './markdown-inline-render'
import { renderListItems } from './markdown-list-render'
import { isThematicBreak, parseListTree } from './markdown-list-parse'
import { closesFence, fencedCodeHtml, openingFence, outdentCodeLine } from './markdown-code-fence'
import { frontMatterEnd, frontMatterHtml } from './markdown-front-matter'
import { opensTable, splitTableRow, tableSourceAttributes } from './markdown-table-rows'
import type { RichMarkdownEditorScope } from './document-scope'
import { reflowLines } from './markdown-reflow'

/** Whether a line opens a block of its own, which is what ends the paragraph being gathered. */
export function isBlockStart(line: string): boolean {
  return (
    isThematicBreak(line) ||
    openingFence(line) !== null ||
    /^(#{1,6}\s+|>\s?|\s*(?:[-*+]|\d+[.)])\s+)/.test(line)
  )
}

/**
 * What ends a wrapped list item's words: a block start, but not a fence, which the list reader
 * does not take into an item and whose indented lines are the item's words as they always were.
 */
function endsListItemWords(line: string): boolean {
  return isBlockStart(line) && openingFence(line) === null
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
  const frontMatter = frontMatterEnd(lines)
  if (frontMatter !== null) {
    html.push(frontMatterHtml(lines.slice(0, frontMatter)))
    index = frontMatter
  }
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
        code.push(outdentCodeLine(lines[index] ?? '', fence.indent))
        index += 1
      }
      if (index < lines.length) {
        index += 1
      }
      html.push(fencedCodeHtml(fence, code.join('\n')))
      continue
    }
    if (isThematicBreak(line)) {
      html.push('<hr />')
      index += 1
      continue
    }
    if (opensTable(line, lines[index + 1])) {
      const headers = splitTableRow(line)
      const source = tableSourceAttributes(line, lines[index + 1] ?? '')
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
      const head = headers.map((cell) => `<th>${renderInline(cell)}</th>`).join('')
      // A row keeps a cell past the header's count: it is still the file's text, and cutting rows
      // to the header deleted it on the next save (every build before 2026-09-23). The header keeps
      // its own width, so a ragged row stays ragged, which GFM allows, rather than the whole table
      // gaining an empty column on the desktop. A short row still pads to the header.
      const body = rows
        .map((row) => {
          const width = Math.max(headers.length, row.length)
          const cells = Array.from({ length: width }, (_, cellIndex) => row[cellIndex] ?? '')
          return `<tr>${cells.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`
        })
        .join('')
      html.push(`<table${source}><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`)
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
      const list = parseListTree(lines, index, endsListItemWords)
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
      !opensTable(lines[index] ?? '', lines[index + 1])
    ) {
      paragraph.push(lines[index] ?? '')
      index += 1
    }
    if (paragraph.length === 0) {
      // Why: a line that opens a block by `isBlockStart` but matches no block reader's own grammar
      // — `# `, `- ` — is gathered by nothing, and the loop would read it again forever. It is
      // text.
      paragraph.push(lines[index] ?? '')
      index += 1
    }
    html.push(`<p>${renderInline(reflowLines(paragraph)).replace(/\n/g, '<br />')}</p>`)
  }
  return html.join('\n') || '<p class="is-empty"><br /></p>'
}
