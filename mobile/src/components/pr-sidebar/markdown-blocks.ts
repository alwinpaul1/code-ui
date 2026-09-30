import { codeSpanContent, createMarkdownInlineMatcher } from '../markdown-inline-matcher'
import {
  afterRefusedUnderscoreOpener,
  emphasisSource,
  isIntrawordUnderscoreToken
} from '../markdown-inline-token-rules'
import { markdownHeadingText } from '../../text/markdown-heading-text'
import { decodeMarkdownHtmlEntities, markdownTextRunWithEntities } from '../markdown-html-entities'
import { markdownLinkDestination } from '../markdown-link-destination'
import { lexCommentBody, type LexedCommentBody } from './markdown-fences'
import { stripHtmlTagsOutsideCode } from './markdown-html-tags'
import { readHtmlBlocks, type HtmlBlockPiece } from './markdown-html-blocks'
import { HR, ORDERED, parseList, UNORDERED } from './markdown-list-blocks'
import { expandBreaksOffTableRows, inlineBreaksAsNewlines, MARKDOWN_INLINE_BREAK } from '../markdown-inline-breaks'

// Tiny, dependency-free markdown model for PR comment bodies. We render GitHub
// markdown without a third-party RN markdown library (the previous dependency hung
// the JS thread when a comment list mounted). Scope is deliberately small — the
// common comment elements — and parsing is pure + total: anything it can't classify
// falls through as paragraph text, so it can never throw on unexpected input.

export type InlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; url: string }

export type CellAlign = 'left' | 'center' | 'right'

/** Where a list item sits: 0 at the list's margin, one more per level of
 *  nesting; the kind of the list it is in, which may not be the outermost
 *  one's; its number in that list; and its box, where it is a task. */
export type ListItemShape = { depth: number; ordered: boolean; number?: number; checked?: boolean }

export type MarkdownBlock =
  | { kind: 'heading'; level: number; text: string }
  // `lang` carries the fence info string (e.g. 'mermaid'); empty when unspecified.
  | { kind: 'code'; text: string; lang: string }
  | { kind: 'quote'; text: string }
  // `start` is the number an ordered list's first item draws, when it is not 1:
  // the list went on after a fence under one of its items, or opened at 3.
  // `shapes`, one per item, only where an item is nested or a task
  // (markdown-list-blocks.ts); each item then draws its own number.
  | { kind: 'list'; ordered: boolean; items: string[]; start?: number; shapes?: ListItemShape[] }
  | { kind: 'hr' }
  | { kind: 'paragraph'; text: string }
  // GitHub comments use <details><summary>…</summary>…</details> for collapsibles.
  | { kind: 'details'; summary: string; body: MarkdownBlock[] }
  // GFM pipe table. `align` is per-column, parallel to `headers`.
  | { kind: 'table'; headers: string[]; rows: string[][]; align: CellAlign[] }

// Its closing run of '#' comes off in markdownHeadingText.
const HEADING = /^(#{1,6})\s+(.*)$/
const QUOTE = /^>\s?(.*)$/

// It moved to markdown-html-tags.ts beside the code-aware stripping.
export { stripHtmlTags } from './markdown-html-tags'

export function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  // Fences out first, with HTML comments and <br> handled around them
  // (markdown-fences.ts): nothing below reads a fence's lines.
  const body = lexCommentBody(content)
  // A `<br>` is a line break, except on a table row, where it is one inside
  // its cell once the cells are split (markdown-inline-breaks.ts). It was a
  // line break everywhere, which cut a row in two.
  const text = expandBreaksOffTableRows(body.text)
  const blocks = parseSegment(readHtmlBlocks(text), body)
  return text.includes(MARKDOWN_INLINE_BREAK) ? blocks.map(withLineBreaks) : blocks
}

/** A block with every `<br>` a table row kept as a line break: in its cells,
 *  and wherever else such a row was read, so none is drawn as a stand-in. */
function withLineBreaks(block: MarkdownBlock): MarkdownBlock {
  const breaks = inlineBreaksAsNewlines
  switch (block.kind) {
    case 'heading':
    case 'quote':
    case 'paragraph':
      return { ...block, text: breaks(block.text) }
    case 'list':
      return { ...block, items: block.items.map(breaks) }
    case 'table':
      return { ...block, headers: block.headers.map(breaks), rows: block.rows.map((row) => row.map(breaks)) }
    case 'details':
      return { ...block, summary: breaks(block.summary), body: block.body.map(withLineBreaks) }
    case 'code':
    case 'hr':
      return block
    default: {
      const unhandled: never = block
      return unhandled
    }
  }
}

// The <details>/<blockquote> regions of a segment, a nested one inside the
// one that holds it, as structured blocks, and the text between them
// line-parsed, in order (markdown-html-blocks.ts finds them).
function parseSegment(pieces: HtmlBlockPiece[], body: LexedCommentBody): MarkdownBlock[] {
  return pieces.flatMap((piece): MarkdownBlock[] => {
    if (piece.kind === 'text') {
      return piece.text.trim().length > 0 ? parseLines(piece.text, body) : []
    }
    if (piece.kind === 'quote') {
      // A quote block holds text, so a fence in it reads as it was written.
      return [{ kind: 'quote', text: stripHtmlTagsOutsideCode(body.restore(piece.text)).trim() }]
    }
    // Drawn as it is, so its entities are decoded here, after its tags are off.
    const summary =
      piece.summary === null
        ? ''
        : decodeMarkdownHtmlEntities(stripHtmlTagsOutsideCode(body.restore(piece.summary)), true).trim()
    return [{ kind: 'details', summary: summary || 'Details', body: parseSegment(piece.body, body) }]
  })
}

function parseLines(content: string, body: LexedCommentBody): MarkdownBlock[] {
  const lines = content.split('\n')
  const blocks: MarkdownBlock[] = []
  let paragraph: string[] = []
  let i = 0

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', text: paragraph.join('\n').trim() })
      paragraph = []
    }
  }

  while (i < lines.length) {
    const line = lines[i]

    // A fence behind a list marker is that item's; the list below takes it.
    const fence = body.fenceOn(line)
    if (fence && !fence.marker) {
      flushParagraph()
      blocks.push({ kind: 'code', ...fence.code })
      i += 1
      continue
    }

    // GFM pipe table: a header row immediately followed by a delimiter row.
    // Requires the delimiter row so plain prose with a stray `|` isn't captured.
    if (line.includes('|') && i + 1 < lines.length && isTableDelimiter(lines[i + 1])) {
      flushParagraph()
      const headers = splitTableRow(line)
      const align = parseAlignRow(lines[i + 1])
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitTableRow(lines[i]))
        i += 1
      }
      blocks.push({ kind: 'table', headers, rows, align })
      continue
    }

    if (line.trim() === '') {
      flushParagraph()
      i += 1
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      flushParagraph()
      blocks.push({ kind: 'heading', level: heading[1].length, text: markdownHeadingText(heading[2]) })
      i += 1
      continue
    }

    if (HR.test(line)) {
      flushParagraph()
      blocks.push({ kind: 'hr' })
      i += 1
      continue
    }

    const quote = QUOTE.exec(line)
    if (quote) {
      flushParagraph()
      const quoted: string[] = []
      let q: RegExpExecArray | null = quote
      while (q) {
        quoted.push(q[1])
        i += 1
        q = i < lines.length ? QUOTE.exec(lines[i]) : null
      }
      blocks.push({ kind: 'quote', text: quoted.join('\n').trim() })
      continue
    }

    if (ORDERED.test(line) || UNORDERED.test(line)) {
      flushParagraph()
      i = parseList(lines, i, body, blocks)
      continue
    }

    paragraph.push(line)
    i += 1
  }
  flushParagraph()
  return blocks
}

// Splits a `| a | b |` table row into trimmed cells the way GitHub does: every `\|` is a
// pipe inside the cell, however many backslashes come before it, so a row ending in `\|`
// has no closing pipe to strip. Upstream #22114 moved this parser onto the editor's
// splitTableRow (rich-markdown/markdown-table-rows.ts), which follows marked and ends a
// cell at the pipe after `\\`; GitHub keeps that pipe in the cell, and PR comment bodies
// are GitHub markdown. Total: never throws on odd input.
function splitTableRow(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let trimmed = line.trim()
  if (trimmed.startsWith('|')) {
    trimmed = trimmed.slice(1)
  }
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) {
    trimmed = trimmed.slice(0, -1)
  }
  for (let j = 0; j < trimmed.length; j += 1) {
    const ch = trimmed[j]
    if (ch === '\\' && trimmed[j + 1] === '|') {
      cell += '|'
      j += 1
      continue
    }
    if (ch === '|') {
      cells.push(cell.trim())
      cell = ''
      continue
    }
    cell += ch
  }
  cells.push(cell.trim())
  return cells
}

// A GFM table delimiter row: cells of dashes with optional leading/trailing
// colons. Checked cell by cell, because the one regex that spelled the whole
// row out backtracked exponentially over a long run of spaces.
function isTableDelimiter(line: string): boolean {
  return splitTableRow(line).every((cell) => /^:?-+:?$/.test(cell))
}

// Reads alignment from a delimiter row's colons: `:--` left, `:-:` center, `--:` right.
function parseAlignRow(line: string): CellAlign[] {
  return splitTableRow(line).map((spec) => {
    const left = spec.startsWith(':')
    const right = spec.endsWith(':')
    if (left && right) {
      return 'center'
    }
    if (right) {
      return 'right'
    }
    return 'left'
  })
}

// Inline emphasis/code/link tokenizer. Walks the string once, longest-match first,
// emitting plain-text runs between matches. Unbalanced markers stay literal text.
// Code spans are found by backtick run inside the matcher, not here.
//
// A bold span may hold whole italic spans of its own character, as the chat's
// markdownInlineTokenPattern does (markdown-inline-matcher.ts has the why):
// `***x***` is bold around `*x*`, and CommentMarkdown draws a bold token's
// inside through parseInline again. `\*\*[^*]+\*\*` drew it as a star, bold x,
// a star (review, 2026-09-30). An italic holds no span, and may run over
// lines, as it did. Every one starts and ends on a character that is not a
// space (emphasisSource), so `x ** 2 + y ** 2` and `2 * 3 * 4` are text: they
// drew " 2 + y " bold and " 3 " italic (same review).
const INLINE = new RegExp(
  [
    emphasisSource('\\*', 2, true),
    emphasisSource('_', 2, true),
    emphasisSource('\\*', 1, true, false),
    emphasisSource('_', 1, true, false)
  ]
    .map((source) => `(${source})`)
    .join('|'),
  'g'
)

/**
 * A run of inline Markdown as tokens. Images, a link label that holds one,
 * and backslash escapes are read as the chat reads them (the matcher's
 * `images` reading): `![shot](i.png)` drew a stray "!" before a link, and a
 * README badge, `[![CI](b.svg)](https://ci)`, a link to the badge image
 * labelled "![CI" (review, 2026-09-30). An image is a link labelled with its
 * alt text, or "image" when it has none. Inside a link's words (`label`), an
 * image is its alt text alone, so a badge is one link to its target, and a
 * link or an address is drawn as written. A text run drops an escape's
 * backslash, as GitHub does: `\*a\*` is two stars around a word, and
 * `\![x](y)` is a "!" and a link. It draws the characters HTML entities stand
 * for, `Vec&lt;T&gt;` as `Vec<T>`, in the same pass (markdown-html-entities.ts).
 * Code keeps its backslashes and entities as written.
 */
export function parseInline(text: string, label = false): InlineToken[] {
  const tokens: InlineToken[] = []
  // Strip residual inline HTML tags (<b>, <kbd>, <sub>, …) so they don't render
  // literally, but only between code spans: `Array<string>` is code, not a tag.
  const plain = stripHtmlTagsOutsideCode(text)
  const matcher = createMarkdownInlineMatcher(plain, INLINE, true, true)
  const textRun = (from: number, to?: number): void => {
    tokens.push({ kind: 'text', text: markdownTextRunWithEntities(plain.slice(from, to)) })
  }
  let cursor = 0
  // Every pass moves matcher.lastIndex forward, so the text's length bounds
  // the passes; the guard is a backstop, not a budget. A flat 5,000 was one,
  // and nothing after the loop kept the rest, so a long generated comment
  // lost its end (review sweep, 2026-09-30).
  let guard = plain.length + 1
  while (cursor < plain.length) {
    guard -= 1
    const m = guard < 0 ? null : matcher.exec()
    if (!m || m.index === undefined) {
      textRun(cursor)
      break
    }
    const token = m[0]
    // An underscore inside a word (snake_case, src/__init__.py) is text, as CommonMark reads it.
    // Only its opener is refused: the scan goes on past the opener's underscore run, as the chat's
    // does, so a span inside it still draws. Taking the whole match as text swallowed the code span
    // in "my_var and `code` and other_var" (review, 2026-09-30).
    if (isIntrawordUnderscoreToken(plain, m.index, token)) {
      matcher.lastIndex = afterRefusedUnderscoreOpener(plain, m.index)
      continue
    }
    if (m.index > cursor) {
      textRun(cursor, m.index)
    }
    if (m.link?.image && label) {
      tokens.push(...(m.link.label ? parseInline(m.link.label, true) : [{ kind: 'text' as const, text: 'image' }]))
    } else if (m.link && label) {
      tokens.push({ kind: 'text', text: token })
    } else if (m.link) {
      tokens.push({ kind: 'link', text: m.link.label || 'image', url: markdownLinkDestination(m.link.href) })
    } else if (token.startsWith('`')) {
      tokens.push({ kind: 'code', text: codeSpanContent(token) })
    } else if (token.startsWith('**') || token.startsWith('__')) {
      tokens.push({ kind: 'bold', text: token.slice(2, -2) })
    } else {
      tokens.push({ kind: 'italic', text: token.slice(1, -1) })
    }
    cursor = matcher.lastIndex
  }
  return tokens
}
