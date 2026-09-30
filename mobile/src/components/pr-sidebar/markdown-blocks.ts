import { codeSpanContent, createMarkdownInlineMatcher } from '../markdown-inline-matcher'
import { emphasisSource, isIntrawordUnderscoreToken } from '../markdown-inline-token-rules'
import { markdownHeadingText } from '../../text/markdown-heading-text'
import { lexCommentBody, type LexedCommentBody } from './markdown-fences'
import { stripHtmlTagsOutsideCode } from './markdown-html-tags'

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

export type MarkdownBlock =
  | { kind: 'heading'; level: number; text: string }
  // `lang` carries the fence info string (e.g. 'mermaid'); empty when unspecified.
  | { kind: 'code'; text: string; lang: string }
  | { kind: 'quote'; text: string }
  // `start` is the number an ordered list's first item draws, when it is not 1:
  // the list went on after a fence under one of its items, or opened at 3.
  | { kind: 'list'; ordered: boolean; items: string[]; start?: number }
  | { kind: 'hr' }
  | { kind: 'paragraph'; text: string }
  // GitHub comments use <details><summary>…</summary>…</details> for collapsibles.
  | { kind: 'details'; summary: string; body: MarkdownBlock[] }
  // GFM pipe table. `align` is per-column, parallel to `headers`.
  | { kind: 'table'; headers: string[]; rows: string[][]; align: CellAlign[] }

// Its closing run of '#' comes off in markdownHeadingText.
const HEADING = /^(#{1,6})\s+(.*)$/
const QUOTE = /^>\s?(.*)$/
// One mark three or more times, spaces between allowed, at most three columns
// in (CommonMark 4.1), as THEMATIC_BREAK in markdown-code-ranges.ts reads it.
// `---+` alone let the list rule take `* * *` for a bullet reading "* *".
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const UNORDERED = /^\s*[-*+]\s+(.*)$/
const ORDERED = /^\s*\d+[.)]\s+(.*)$/
// A top-level <details>…</details> or <blockquote>…</blockquote> region.
const HTML_BLOCK = /<(details|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/i
const SUMMARY = /<summary\b[^>]*>([\s\S]*?)<\/summary>/i

// It moved to markdown-html-tags.ts beside the code-aware stripping.
export { stripHtmlTags } from './markdown-html-tags'

export function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  // Fences out first, with HTML comments and <br> handled around them
  // (markdown-fences.ts): nothing below reads a fence's lines.
  const body = lexCommentBody(content)
  return parseSegment(body.text, body)
}

// Splits a segment at top-level <details>/<blockquote> regions (preserving order),
// emitting structured blocks for them and line-parsing the text in between. Recurses
// for nested details bodies. Non-greedy match keeps it total on unbalanced input.
// A fence is one placeholder line here, so a tag inside one splits nothing.
function parseSegment(text: string, body: LexedCommentBody): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  let rest = text
  let m = HTML_BLOCK.exec(rest)
  while (m) {
    const before = rest.slice(0, m.index)
    if (before.trim().length > 0) {
      blocks.push(...parseLines(before, body))
    }
    if (m[1].toLowerCase() === 'details') {
      const sm = SUMMARY.exec(m[2])
      const summary = sm ? stripHtmlTagsOutsideCode(body.restore(sm[1])).trim() : 'Details'
      const inside = m[2].replace(SUMMARY, '')
      blocks.push({ kind: 'details', summary: summary || 'Details', body: parseSegment(inside, body) })
    } else {
      // A quote block holds text, so a fence in it reads as it was written.
      blocks.push({ kind: 'quote', text: stripHtmlTagsOutsideCode(body.restore(m[2])).trim() })
    }
    rest = rest.slice(m.index + m[0].length)
    m = HTML_BLOCK.exec(rest)
  }
  if (rest.trim().length > 0) {
    blocks.push(...parseLines(rest, body))
  }
  return blocks
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

    const ordered = ORDERED.test(line)
    if (ordered || UNORDERED.test(line)) {
      flushParagraph()
      i = parseList(lines, i, ordered, body, blocks)
      continue
    }

    paragraph.push(line)
    i += 1
  }
  flushParagraph()
  return blocks
}

// The list opening at `lines[i]`, pushed onto `blocks`; returns the index after it.
function parseList(
  lines: string[],
  i: number,
  ordered: boolean,
  body: LexedCommentBody,
  blocks: MarkdownBlock[]
): number {
  const marker = ordered ? ORDERED : UNORDERED
  let items: string[] = []
  // CommonMark numbers an ordered list from its first item's number, of at
  // most nine digits; a longer one parseInt rounds, so that list counts from 1.
  const number = ordered ? /\d+/.exec(lines[i]!)![0] : '1'
  let start = number.length <= 9 ? Number(number) : 1
  const flush = (): void => {
    blocks.push(ordered && start !== 1 ? { kind: 'list', ordered, items, start } : { kind: 'list', ordered, items })
    start += items.length
    items = []
  }
  let match = marker.exec(lines[i]!)
  while (match) {
    // A fence can open on the item's own line; the item then holds only it.
    let fence = body.fenceOn(match[1])?.code ?? null
    // A wrapped item continues on the lines under it: indented, non-blank,
    // and not a marker of its own. Without this the list ended at the first
    // continuation line, that line became a paragraph at the left margin,
    // and the next item opened a fresh list — so every item was numbered 1.
    // GitHub comment bodies are hard-wrapped by every editor that soft-wraps.
    const parts = fence ? [] : [match[1].trim()]
    i += 1
    while (!fence && i < lines.length) {
      const next = lines[i]!
      if (!next.trim() || !/^\s/.test(next) || ORDERED.test(next) || UNORDERED.test(next)) {
        break
      }
      fence = body.fenceOn(next)?.code ?? null
      if (!fence) {
        parts.push(next.trim())
      }
      i += 1
    }
    // Joined with a space: a single newline inside a paragraph is not a line
    // break in markdown, it reflows.
    items.push(parts.join(' '))
    if (fence) {
      // A fence under an item ends the item: the list so far, then the code,
      // and the list goes on, still counting, at the next marker of its kind.
      flush()
      blocks.push({ kind: 'code', ...fence })
    }
    match = i < lines.length ? marker.exec(lines[i]!) : null
  }
  if (items.length > 0) {
    flush()
  }
  return i
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

export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = []
  // Strip residual inline HTML tags (<b>, <kbd>, <sub>, …) so they don't render
  // literally, but only between code spans: `Array<string>` is code, not a tag.
  const plain = stripHtmlTagsOutsideCode(text)
  const matcher = createMarkdownInlineMatcher(plain, INLINE, false, true)
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
      tokens.push({ kind: 'text', text: plain.slice(cursor) })
      break
    }
    const token = m[0]
    // An underscore inside a word (snake_case, src/__init__.py) is text, as CommonMark reads it.
    // Only its opener is refused: the scan goes on from the next character, as the chat's does,
    // so a span inside it still draws. Taking the whole match as text swallowed the code span in
    // "my_var and `code` and other_var" (review, 2026-09-30).
    if (isIntrawordUnderscoreToken(plain, m.index, token)) {
      matcher.lastIndex = m.index + 1
      continue
    }
    if (m.index > cursor) {
      tokens.push({ kind: 'text', text: plain.slice(cursor, m.index) })
    }
    if (token.startsWith('`')) {
      tokens.push({ kind: 'code', text: codeSpanContent(token) })
    } else if (token.startsWith('**') || token.startsWith('__')) {
      tokens.push({ kind: 'bold', text: token.slice(2, -2) })
    } else if (token.startsWith('[')) {
      const close = token.indexOf('](')
      tokens.push({
        kind: 'link',
        text: token.slice(1, close),
        url: token.slice(close + 2, -1)
      })
    } else {
      tokens.push({ kind: 'italic', text: token.slice(1, -1) })
    }
    cursor = matcher.lastIndex
  }
  return tokens
}
