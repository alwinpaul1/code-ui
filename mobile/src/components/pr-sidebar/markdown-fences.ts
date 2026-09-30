import { markdownCodeRanges } from '../markdown-code-ranges'
import { codeSpanReader } from './markdown-html-tags'

/**
 * The fenced code blocks of a PR comment body, taken out before anything
 * reads its lines as Markdown or HTML.
 *
 * The comment reader took any line starting with ``` for a fence and closed
 * it at the next one, and split the text at <details>/<blockquote> before it
 * read a line (review, 2026-09-30): a ```` fence holding a ``` one split into
 * three blocks, a one-line ```npm i``` span ran to the end of the comment, ~~~
 * and a fence under a list item were text, and a <details> inside a fence
 * opened a real collapsible. The fences are now found by markdownCodeRanges
 * (markdown-code-ranges.ts), the chat's CommonMark fence lexer: a run of
 * three or more backticks or tildes at most three columns into its list item
 * or the margin, closed only by a run of the same mark at least as long with
 * nothing after it, and never a backtick run whose info string holds a
 * backtick. Each fence then stands in the text as one placeholder line, so the
 * <details> split and the line reader never see its lines.
 *
 * HTML comments and `<br>` are handled in the same pass, top down, because
 * they and a fence can each hold the other: a comment opened first hides a
 * fence inside it (PR templates keep example fences in their comments), and a
 * fence opened first keeps `<!-- -->` and `<br>` as code. On a line of text a
 * code span keeps them the same way, whichever opens first. The whole-text
 * regexes this replaces took them out of code everywhere.
 *
 * A fence inside a `>` quote stays text, as it was: the quote block holds
 * text only.
 */

export type FencedCode = { text: string; lang: string }

export type LexedCommentBody = {
  /** The body with its comments out, `<br>` as a line break, and each fence
   *  as one placeholder line, behind the list marker it opened after. */
  text: string
  /** The fence a line stands for, and the list marker before it if any. */
  fenceOn: (line: string) => { marker: boolean; code: FencedCode } | null
  /** `text` with each placeholder back as the fence's own lines, for a
   *  region drawn as text (a <blockquote> body). */
  restore: (text: string) => string
}

/** What may stand before a fence run on its first line: an indent, or a list
 *  item's marker. A `>` there is a fence inside a quote. */
const FENCE_PREFIX = /^[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?(?=`{3,}|~{3,})/
const FENCE_OPENER = /^(`{3,}|~{3,})(.*)$/
const BREAK = /<br\s*\/?>/gi
/** A comment that swallows an unclosed fence opener leaves the lexer's view
 *  of the lines after it wrong, and they are read again. Past this many, the
 *  rest keeps the view it has, so a comment built of such comments cannot
 *  make the reading quadratic. */
const RELEX_LIMIT = 8
/** Likewise for asking the lexer whether a fence's last line closed it. */
const PROBE_LIMIT = 8

type Fence = { code: FencedCode; prefix: string; source: string }

/** Column after the leading spaces and tabs of `text` up to `end`. */
function columnAt(text: string, end: number): number {
  let column = 0
  for (let index = 0; index < end; index += 1) {
    column = text[index] === '\t' ? column + 4 - (column % 4) : column + 1
  }
  return column
}

function leadingColumn(line: string): number {
  let index = 0
  while (line[index] === ' ' || line[index] === '\t') {
    index += 1
  }
  return columnAt(line, index)
}

/** `line` with up to `columns` columns of its indent taken off. */
function outdent(line: string, columns: number): string {
  let index = 0
  let column = 0
  while ((line[index] === ' ' || line[index] === '\t') && column < columns) {
    const next = line[index] === '\t' ? column + 4 - (column % 4) : column + 1
    if (next > columns) {
      break
    }
    column = next
    index += 1
  }
  return line.slice(index)
}

/** A line of text outside any fence and comment: its closed comments out and
 *  `<br>` as a line break, neither where a code span on the line holds it.
 *  `opens` says a comment opened on it and closes on a later line. */
function scanLine(line: string, offset: number, lastClose: number): { text: string; opens: boolean } {
  if (!line.includes('<')) {
    return { text: line, opens: false }
  }
  const nextSpan = codeSpanReader(line)
  let text = ''
  let at = 0
  // The next `<!--` at or after `at`, found again only once `at` passes it,
  // so a line of many code spans before one comment is still one pass.
  let open = -2
  for (;;) {
    if (open !== -1 && open < at) {
      open = line.indexOf('<!--', at)
      // `<!--` with no `-->` anywhere after it is text, as the regex left
      // it, and so is every `<!--` after it.
      if (open !== -1 && lastClose < offset + open + 4) {
        open = -1
      }
    }
    const span = nextSpan(at)
    if (span && (open === -1 || span[0] < open)) {
      text += line.slice(at, span[0]).replace(BREAK, '\n') + line.slice(span[0], span[1])
      at = span[1]
      continue
    }
    if (open === -1) {
      return { text: text + line.slice(at).replace(BREAK, '\n'), opens: false }
    }
    text += line.slice(at, open).replace(BREAK, '\n')
    const close = line.indexOf('-->', open + 4)
    if (close === -1) {
      return { text, opens: true }
    }
    at = close + 3
  }
}

export function lexCommentBody(content: string): LexedCommentBody {
  // CRLF only, as the line reader always split: a lone CR stays in its line,
  // where a table row reads it as a space.
  const normalized = content.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const lastClose = normalized.lastIndexOf('-->')
  const out: (string | number)[] = []
  const fences: Fence[] = []
  // The fences as the lexer reads `lexed`, which is `lines` from `base` on.
  let lexed = lines
  let base = 0
  let ranges = markdownCodeRanges(lexed)
  let relexes = 0
  let probes = 0
  // The text before a comment that is still open, and the line it opened on.
  let pending: string | null = null
  let commentLine = 0
  let offset = 0

  const closesFence = (start: number, end: number, run: string, openColumn: number): boolean => {
    const last = lexed[end - base - 1] ?? ''
    const trimmed = last.trim()
    if (end - 1 <= start || trimmed.length < run.length || trimmed !== run[0]!.repeat(trimmed.length)) {
      return false
    }
    const column = leadingColumn(last)
    // Its item's content sits at most three columns before the opener, and a
    // closer is less than four columns into it; between the two, only the
    // lexer knows the item, so ask it whether one more copy stays inside.
    if (column <= openColumn || column >= openColumn + 4 || probes >= PROBE_LIMIT) {
      return column < openColumn + 4
    }
    probes += 1
    const probe = markdownCodeRanges(lexed.slice(0, end - base).concat(last))
    return probe.get(start - base) === end - base
  }

  const takeFence = (start: number, end: number, prefix: string): void => {
    const opener = lines[start]!
    const [, run = '```', info = ''] = FENCE_OPENER.exec(opener.slice(prefix.length)) ?? []
    const openColumn = columnAt(opener, prefix.length)
    const closed = closesFence(start, end, run, openColumn)
    const body = lines.slice(start + 1, closed ? end - 1 : end).map((line) => outdent(line, openColumn))
    const lang = (info.trim().split(/[ \t]/)[0] ?? '').toLowerCase()
    fences.push({ code: { text: body.join('\n'), lang }, prefix, source: lines.slice(start, end).join('\n') })
    out.push(fences.length - 1)
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (pending === null) {
      const end = ranges.get(i - base)
      const prefix = end === undefined ? null : FENCE_PREFIX.exec(line)
      if (end !== undefined && prefix) {
        takeFence(i, end + base, prefix[0])
        for (; i < end + base; i += 1) {
          offset += lines[i]!.length + 1
        }
        continue
      }
      const scanned = scanLine(line, offset, lastClose)
      if (scanned.opens) {
        pending = scanned.text
        commentLine = i
      } else {
        out.push(scanned.text)
      }
    } else {
      const close = line.indexOf('-->')
      if (close !== -1) {
        const rest = scanLine(line.slice(close + 3), offset + close + 3, lastClose)
        pending += rest.text
        if (!rest.opens) {
          out.push(pending)
          pending = null
          // A fence the lexer opened inside the comment and ran past its end
          // hid the lines after it; read them again, as the comment left them.
          let crossed = false
          for (let row = commentLine; row <= i && !crossed; row += 1) {
            crossed = (ranges.get(row - base) ?? -1) + base > i + 1
          }
          if (crossed && relexes < RELEX_LIMIT) {
            relexes += 1
            base = i + 1
            lexed = lines.slice(base)
            ranges = markdownCodeRanges(lexed)
          }
        }
      }
    }
    offset += line.length + 1
    i += 1
  }
  // A comment opens only with a `-->` after it, so none is open here; were
  // one ever, the text before it still stands.
  if (pending !== null) {
    out.push(pending)
  }

  // A mark the text cannot hold: longer than its longest run of U+E000.
  let longest = 0
  for (const piece of out) {
    if (typeof piece === 'string') {
      for (const run of piece.match(/\uE000+/g) ?? []) {
        longest = Math.max(longest, run.length)
      }
    }
  }
  const mark = '\uE000'.repeat(longest + 1)
  const text = out
    .map((piece) => (typeof piece === 'string' ? piece : `${fences[piece]!.prefix}${mark}${piece}${mark}`))
    .join('\n')
  const onLine = new RegExp(`^[ \\t]*((?:[-*+]|\\d{1,9}[.)])[ \\t]+)?${mark}(\\d+)${mark}[ \\t]*$`)
  const anywhere = new RegExp(`${mark}(\\d+)${mark}`, 'g')
  return {
    text,
    fenceOn: (line) => {
      const match = line.includes(mark) ? onLine.exec(line) : null
      const fence = match ? fences[Number(match[2])] : undefined
      return fence ? { marker: Boolean(match![1]), code: fence.code } : null
    },
    restore: (value) =>
      value.includes(mark)
        ? value.replace(anywhere, (whole, index: string) => {
            const fence = fences[Number(index)]
            return fence ? fence.source.slice(fence.prefix.length) : whole
          })
        : value
  }
}
