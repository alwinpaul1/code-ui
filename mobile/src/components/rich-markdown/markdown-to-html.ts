import { renderInline } from './markdown-inline-render'
import { renderListItems } from './markdown-list-render'
import { parseListTree } from './markdown-list-parse'
import { isThematicBreak } from './markdown-lazy-line'
import { closesFence, fencedCodeHtml, openingFence, outdentCodeLine } from './markdown-code-fence'
import { frontMatterEnd, frontMatterHtml } from './markdown-front-matter'
import {
  indentedCodeHtml,
  readIndentedCode,
  setextHeadingHtml,
  setextLevel
} from './markdown-leaf-blocks'
import { opensTable, readTableRows, tableHtml } from './markdown-table-rows'
import type { RichMarkdownEditorScope } from './document-scope'
import { paragraphParts, reflowLines } from './markdown-reflow'
import { quoteHtml, quoteLineContent, readQuoteLines } from './markdown-quote'

/** Whether a line opens a block of its own, which is what ends the paragraph being gathered. */
export function isBlockStart(line: string): boolean {
  return (
    isThematicBreak(line) ||
    openingFence(line) !== null ||
    /^(#{1,6}\s+|>\s?|\s*(?:[-*+]|\d+[.)])\s+)/.test(line)
  )
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
      html.push(fencedCodeHtml(fence, code))
      continue
    }
    if (isThematicBreak(line)) {
      html.push('<hr />')
      index += 1
      continue
    }
    if (opensTable(line, lines[index + 1])) {
      const table = readTableRows(lines, index + 2, 0)
      html.push(tableHtml(line, lines[index + 1] ?? '', table.rows))
      index = table.nextIndex
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      const level = heading[1]!.length
      html.push(`<h${level}>${renderInline(heading[2]!.trim())}</h${level}>`)
      index += 1
      continue
    }
    if (quoteLineContent(line) !== null) {
      const quote = readQuoteLines(lines, index)
      html.push(quoteHtml(quote.lines))
      index = quote.nextIndex
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
    // Four columns in, where no other block took the line: code, as CommonMark reads it. A line
    // four columns in under a paragraph is the paragraph's, and never reaches here.
    const indented = readIndentedCode(lines, index, 0)
    if (indented !== null) {
      html.push(indentedCodeHtml(indented.code))
      index = indented.nextIndex
      continue
    }
    const paragraph: string[] = []
    let underline: string | null = null
    while (index < lines.length && (lines[index] ?? '').trim()) {
      const current = lines[index] ?? ''
      // A `=` or `-` run under a paragraph makes it a heading: `Title\n---` is a level-2 heading,
      // not a paragraph and a rule, as CommonMark and GitHub read it.
      if (paragraph.length > 0 && setextLevel(current) !== null) {
        underline = current
        index += 1
        break
      }
      if (isBlockStart(current) || opensTable(current, lines[index + 1])) {
        break
      }
      paragraph.push(current)
      index += 1
    }
    if (paragraph.length === 0) {
      // Why: a line that opens a block by `isBlockStart` but matches no block reader's own grammar
      // — `# `, `- ` — is gathered by nothing, and the loop would read it again forever. It is
      // text.
      paragraph.push(lines[index] ?? '')
      index += 1
    }
    if (underline !== null) {
      html.push(setextHeadingHtml(renderInline(reflowLines(paragraph).replace(/\n/g, ' ')), underline))
      continue
    }
    const drawn = paragraphParts(paragraph, renderInline)
    html.push(`<p${drawn.attributes}>${drawn.html}</p>`)
  }
  return html.join('\n') || '<p class="is-empty"><br /></p>'
}
