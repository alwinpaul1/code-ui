import { markdownCodeRanges } from './markdown-code-ranges'
import { markdownCodeSpans } from './markdown-code-spans'

// Why: Markdown code is literal source, so it must bypass the HTML strip pass
// (mobile-markdown-preview-html.ts). Each code block and code span is swapped
// for a placeholder before the pass and put back after it. Moved out of that
// file on 2026-09-30, when finding spans across a line break made it too long.
const CODE_PLACEHOLDER_PREFIX_BASE = '\uE000ORCA_MD_CODE_'
const CODE_PLACEHOLDER_SUFFIX = '\uE000'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function codePlaceholderPrefix(content: string): string {
  let suffixLength = 0
  let cursor = 0
  while ((cursor = content.indexOf(CODE_PLACEHOLDER_PREFIX_BASE, cursor)) !== -1) {
    cursor += CODE_PLACEHOLDER_PREFIX_BASE.length
    const suffixStart = cursor
    while (content[cursor] === '_') {
      cursor += 1
    }
    // One extra underscore keeps the prefix longer than every authored run.
    suffixLength = Math.max(suffixLength, cursor - suffixStart + 1)
  }
  return CODE_PLACEHOLDER_PREFIX_BASE + '_'.repeat(suffixLength)
}

/** A line that is a block of its own, which no code span runs into or out
 *  of: a heading, a rule, a setext underline, or a table row (read as any
 *  line with a pipe, one line at a time as this pass always read them). */
const BLOCK_LINE = /^ {0,3}(?:#{1,6}(?:[ \t]|$)|([-*_])(?:[ \t]*\1){2,}[ \t]*$|=+[ \t]*$)|\|/
const LIST_ITEM_LINE = /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/
const QUOTE_LINE = /^ {0,3}>/

/**
 * Where a line sits among the lines whose code spans are found together. A
 * code span may run across a soft line break, as `` `<b>x `` / `` y</b>` ``
 * does, but never out of its paragraph: a blank line, a line that is a block
 * of its own, a new list item and the first line of a quote each start
 * afresh. The pass found spans one line at a time, a backtick and anything
 * up to the next, so the tags in a span across two lines were rewritten to
 * `**x y**` before the screen drew the span (review, 2026-09-30).
 */
function spanBoundary(line: string, previous: string | undefined): 'continues' | 'starts' | 'alone' {
  if (!line.trim() || BLOCK_LINE.test(line)) {
    return 'alone'
  }
  if (
    previous === undefined ||
    LIST_ITEM_LINE.test(line) ||
    (QUOTE_LINE.test(line) && !QUOTE_LINE.test(previous))
  ) {
    return 'starts'
  }
  return 'continues'
}

/** The text with each code span swapped for its placeholder, found by the
 *  rule the screen's matcher uses (markdown-code-spans.ts), escapes and all. */
function protectCodeSpans(text: string, store: (code: string) => string): string {
  if (!text.includes('`')) {
    return text
  }
  let protectedText = ''
  let at = 0
  for (const span of markdownCodeSpans(text, true)) {
    protectedText += text.slice(at, span.index) + store(text.slice(span.index, span.end))
    at = span.end
  }
  return protectedText + text.slice(at)
}

export function protectMarkdownCode(
  content: string,
  /** Indented code blocks too, which only a whole document can tell apart
   *  from indented HTML (markdown-code-ranges.ts). */
  indentedCode = false
): {
  protectedText: string
  codeSpans: string[]
  placeholderPrefix: string
} {
  const placeholderPrefix = codePlaceholderPrefix(content)
  const codeSpans: string[] = []
  const store = (match: string): string => {
    const token = `${placeholderPrefix}${codeSpans.length}${CODE_PLACEHOLDER_SUFFIX}`
    codeSpans.push(match)
    return token
  }

  const lines = content.split('\n')
  const protectedLines: string[] = []
  const blocks = markdownCodeRanges(lines, { indentedCode })
  // The lines one block's text could hold, whose code spans may run across
  // a soft line break (see spanBoundary).
  let run: string[] = []
  const flush = (): void => {
    if (run.length > 0) {
      protectedLines.push(protectCodeSpans(run.join('\n'), store))
      run = []
    }
  }
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    const blockEnd = blocks.get(index)
    if (blockEnd !== undefined) {
      flush()
      protectedLines.push(store(lines.slice(index, blockEnd).join('\n')))
      index = blockEnd
      continue
    }
    const boundary = spanBoundary(line, run.at(-1))
    if (boundary !== 'continues') {
      flush()
    }
    run.push(line)
    if (boundary === 'alone') {
      flush()
    }
    index += 1
  }
  flush()

  return { protectedText: protectedLines.join('\n'), codeSpans, placeholderPrefix }
}

export function restoreMarkdownCode(
  value: string,
  codeSpans: string[],
  placeholderPrefix: string
): string {
  const placeholderPattern = new RegExp(
    `${escapeRegExp(placeholderPrefix)}(\\d+)${escapeRegExp(CODE_PLACEHOLDER_SUFFIX)}`,
    'g'
  )
  return value.replace(placeholderPattern, (_token, index) => codeSpans[Number(index)] ?? _token)
}
