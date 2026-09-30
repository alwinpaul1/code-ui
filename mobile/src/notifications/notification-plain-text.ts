import { markdownCodeSpans } from '../components/markdown-code-spans'
import { createMarkdownLinkFinder, type MarkdownLinkSpan } from '../components/markdown-inline-links'
import { markdownHeadingText } from '../text/markdown-heading-text'

/**
 * Agents summarise their turn in Markdown; Android notifications take plain
 * strings and render none of it, so "**Done** — fixed `foo`" showed its
 * asterisks and backticks. There is no styled-text API in expo-notifications,
 * but the shade renders any Unicode, so emphasis is carried by the
 * Mathematical Alphanumeric letterforms: **bold** → 𝗯𝗼𝗹𝗱, *italic* → 𝘪𝘵𝘢𝘭𝘪𝘤,
 * `code` → 𝚌𝚘𝚍𝚎. Only ASCII letters and digits have such forms; anything else
 * is kept as typed. Headings read as bold, list markers become "•", links keep
 * their visible text, and blank-line runs collapse.
 */
export function notificationPlainText(markdown: string): string {
  const raw = markdown
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .flatMap((line) => reflowInlineTable(line))
  const lines = raw
    .map((line) =>
      line
        // A rule first: the bullet rewrite below turned `* * *` and `- - -`
        // into "• * *" and "• - -". One character repeated, as CommonMark
        // has it, so `- * -` is still a bullet.
        .replace(/^\s*([-*_])(?:\s*\1){2,}\s*$/, '')
        .replace(/^\s*(```+|~~~+)[^\n]*$/, '')
        .replace(/^\s{0,3}#{1,6}\s+(.*)$/, (_, text: string) =>
          styleText(markdownHeadingText(text), 'bold')
        )
        .replace(/^(\s*)[*\-+]\s+/, '$1• ')
        .replace(/^\s*>\s?/, '')
    )
    // Links first, looked for with the code spans hidden (linkWords), then
    // code and emphasis: a link's words are styled like any others, and the
    // brackets inside a code span are the code's.
    .map((line) =>
      linkWords(line)
        .replace(/`([^`]*)`/g, (_, text: string) => styleText(text, 'mono'))
        .replace(/(\*\*\*|___)(?=\S)([\s\S]*?\S)\1/g, (_, __, text: string) =>
          styleText(text, 'bolditalic')
        )
        .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, (_, __, text: string) => styleText(text, 'bold'))
        .replace(/(^|[^\w*])\*([^*\s](?:[^*]*?[^*\s])?)\*(?!\w)/g, (_, lead: string, text: string) =>
          lead + styleText(text, 'italic')
        )
        .replace(/(^|[^\w_])_([^_\s](?:[^_]*?[^_\s])?)_(?!\w)/g, (_, lead: string, text: string) =>
          lead + styleText(text, 'italic')
        )
        .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')
        // Not `/\s+$/`: that tries again from every space of a long run,
        // 951 ms for a line holding 40,000 of them. The same characters go.
        .trimEnd()
    )
  const tableLines = classifyTableLines(raw)
  const flattened: string[] = []
  lines.forEach((line, index) => {
    const kind = tableLines[index]
    if (kind === 'separator') {
      // Dropped ENTIRELY rather than blanked. A blank here survives the collapse
      // below (its predecessor is the header), and Android's collapsed banner
      // shows two lines — so the header takes one, the blank takes the other,
      // and the content row falls below the fold.
      return
    }
    flattened.push(kind === 'row' ? flattenTableRow(line) : line)
  })
  return flattened
    .filter(
      (line, index, all) => line.trim() !== '' || (index > 0 && all[index - 1]!.trim() !== '')
    )
    .join('\n')
    .trim()
}

/**
 * A line with each link and image read as its words: `[w](a)` is `w`,
 * `![alt](src)` is `alt`, and a README badge, `[![CI](b.svg)](r)`, is `CI`.
 *
 * Where each one ends is the chat's own reading (markdown-inline-links.ts), so
 * an address ends at the `)` that balances it. The pattern this replaced
 * stopped at the first `)`, which left `)` after the words of every Wikipedia
 * link and drew a badge as `![CI](r)` (review, 2026-09-30). A link that never
 * closes, or one with no words, stays as written, which is how the chat draws
 * it; an image may have no words, and reads as nothing.
 *
 * One pass with a stack rather than a call per label: an image's words can
 * hold another image, and a body nesting thousands of them would run out of
 * stack.
 *
 * Links are looked for with every code span hidden: a code span binds tighter
 * than a link (CommonMark), so `handlers[name](args)` written as code is code.
 * It was read as a link and drew as mono "handlersname" (review, 2026-09-30).
 * A link whose words hold a whole code span, [`x`](u), is still a link.
 */
function linkWords(line: string): string {
  const find = createMarkdownLinkFinder(withCodeHidden(line), true)
  /** Links whose words are being read, the innermost last. */
  const inside: MarkdownLinkSpan[] = []
  let out = ''
  let copied = 0
  let next = find(0)
  for (;;) {
    const words = inside[inside.length - 1]
    if (words && (next === null || next.index >= words.labelEnd)) {
      // The words end: keep them, and drop the `](address)` after them.
      out += line.slice(copied, words.labelEnd)
      copied = words.end
      inside.pop()
      if (next !== null && next.index < copied) {
        next = find(copied)
      }
      continue
    }
    if (next === null) {
      return out + line.slice(copied)
    }
    if (words && next.end > words.labelEnd) {
      // It starts in these words and ends past them. Only a whole image sits
      // in a link's words, so here it is text.
      next = find(next.index + 1)
      continue
    }
    out += line.slice(copied, next.index)
    copied = next.index + (next.image ? 2 : 1)
    inside.push(next)
    next = find(copied)
  }
}

/** The line with each code span's characters swapped for one no link rule
 *  reads, the same length, so every index still lines up with the line. */
function withCodeHidden(line: string): string {
  let out = ''
  let copied = 0
  for (const span of markdownCodeSpans(line, false)) {
    out += line.slice(copied, span.index) + CODE_FILLER.repeat(span.end - span.index)
    copied = span.end
  }
  return copied === 0 ? line : out + line.slice(copied)
}

const CODE_FILLER = '\uE000'

/**
 * A table the desktop squashed onto one line, put back on its lines.
 *
 * The body of a notification is not the agent's text: Orca's composer runs
 * `replace(/\s+/g, ' ')` over it (1.4.205), so every newline is a space by the
 * time it reaches the phone. A four-line table arrives as
 * `| | | |---|---| | Backend | 7365 passed | | Frontend | 412 passed |`, one
 * line, and the line-based reader below found no separator LINE and left
 * every pipe standing (Galaxy S23, 2026-09-18).
 *
 * The delimiter run (three dashes or more per cell) is still unmistakable
 * mid-line, and it states the column
 * count. Cells are then dealt out N at a time: the header is the N cells that
 * end just before the delimiter, each body row is N cells after it, and rows
 * are separated by the blank segment a closing pipe and the next opening pipe
 * leave between them. Whatever is left in front is prose, and so is anything
 * after the last complete row that has no pipes of its own. Each row comes
 * back as its own `| a | b |` line for the reader below, which is how a
 * multi-line table has always been read; nothing here formats.
 */
function reflowInlineTable(line: string): string[] {
  // Three dashes or more: a lone `-` is a cell that says "none", and reflowing
  // `| tsc | - |` around it would cut a row in two.
  const delimiter = /\|(\s*:?-{3,}:?\s*\|)+/.exec(line)
  if (!delimiter || delimiter.index === undefined) {
    return [line]
  }
  const columns = delimiter[0].split('|').length - 2
  const before = line.slice(0, delimiter.index)
  const after = line.slice(delimiter.index + delimiter[0].length)
  // A separator that is the whole line, or one with only pipes around it, is
  // the multi-line case the reader below already handles.
  if (before.trim() === '' && after.trim() === '') {
    return [line]
  }
  const out: string[] = []
  // The header: the N cells whose closing pipe is the last thing before the
  // delimiter. Fewer segments than that, or a non-blank tail, and there is no
  // header, only prose.
  const head = before.split('|')
  let prose = before
  if (head.length >= columns + 2 && head[head.length - 1]!.trim() === '') {
    const cells = head.slice(-(columns + 1), -1)
    prose = head.slice(0, -(columns + 1)).join('|')
    if (cells.some((cell) => cell.trim() !== '')) {
      out.push(`|${cells.join('|')}|`)
    }
  }
  if (prose.trim() !== '') {
    out.unshift(prose.trim())
  }
  out.push(delimiter[0].trim())
  // Body rows: after the delimiter's closing pipe comes a blank segment, then
  // N cells, then the blank the next row's opening pipe leaves, and so on.
  const tail = after.split('|')
  let at = 0
  while (at < tail.length) {
    const boundary = tail[at]!
    if (boundary.trim() !== '') {
      break
    }
    const cells = tail.slice(at + 1, at + 1 + columns)
    if (cells.length < columns) {
      break
    }
    out.push(`|${cells.join('|')}|`)
    at += 1 + columns
  }
  const rest = tail.slice(at).join('|').trim()
  if (rest !== '') {
    out.push(rest)
  }
  return out
}

/** A GFM delimiter row, with or without the optional outer pipes. */
function isTableSeparator(line: string): boolean {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  if (!inner.includes('-')) {
    return false
  }
  return inner.split('|').every((cell) => /^\s*:?-+:?\s*$/.test(cell))
}

/**
 * Which lines belong to a table, decided over the whole text rather than line by
 * line.
 *
 * Two ways a line qualifies, because two different things can go wrong.
 *
 * A line fenced by pipes on both sides is a row by itself: notification bodies
 * are excerpts and can start part-way through a table, with the header and
 * delimiter cut off.
 *
 * GFM also makes those outer pipes OPTIONAL, so `Check | Result` is a real row —
 * and so is `ls | wc -l` in prose, which is indistinguishable in isolation. What
 * makes a table a table there is the DELIMITER row, so a bare row counts only
 * when a delimiter sits directly under its header. Demanding outer pipes was the
 * whole rule before, which let a raw `--- | ---` reach the shade.
 */
function classifyTableLines(lines: readonly string[]): ('row' | 'separator' | undefined)[] {
  const kinds: ('row' | 'separator' | undefined)[] = lines.map((line) =>
    // A body is an EXCERPT of an agent's turn, so it can begin part-way through
    // a table with the header and delimiter cut off. A line fenced by pipes on
    // both sides is a row on its own evidence, which is what keeps a truncated
    // table readable. It is also why a line of prose wrapped in pipes is
    // flattened: a mid-table excerpt is far likelier than that.
    /^\s*\|.+\|\s*$/.test(line) ? 'row' : undefined
  )
  lines.forEach((line, index) => {
    if (!isTableSeparator(line)) {
      return
    }
    // A VETO as well as an anchor, and unconditionally: nothing else in Markdown
    // looks like `--- | ---`, so it is a delimiter on its own evidence whatever
    // sits above it. An excerpt can begin AT one, and before this that left a
    // bare table entirely raw and flattened a piped one into "--- · ---" — the
    // outer-pipe rule above had already claimed it as a row.
    kinds[index] = 'separator'
    const header = index > 0 ? lines[index - 1] : undefined
    // A header only exists when there is a line above WITH cells in it.
    if (header !== undefined && header.includes('|')) {
      kinds[index - 1] = 'row'
    }
    for (let body = index + 1; body < lines.length; body += 1) {
      if (!lines[body]!.includes('|')) {
        break
      }
      kinds[body] = 'row'
    }
  })
  return kinds
}

/**
 * One table row as a single readable line. A table is a layout and the shade has
 * no columns, so cells are joined by a middot. Before this, a row kept every
 * pipe and an agent answering with a table filled the notification with "||||"
 * and no readable summary (reported from the phone 2026-09-17).
 */
function flattenTableRow(line: string): string {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
    .filter((cell) => cell !== '')
    .join(' \u00b7 ')
}

type TextStyle = 'bold' | 'italic' | 'bolditalic' | 'mono'

// Code points of the first glyph ("A", "a", "0") in each Mathematical
// Alphanumeric block. Sans-serif faces match the shade's own typeface.
const STYLE_BASES: Record<TextStyle, { upper: number; lower: number; digit: number | null }> = {
  bold: { upper: 0x1d5d4, lower: 0x1d5ee, digit: 0x1d7ec },
  italic: { upper: 0x1d608, lower: 0x1d622, digit: null },
  bolditalic: { upper: 0x1d63c, lower: 0x1d656, digit: 0x1d7ec },
  mono: { upper: 0x1d670, lower: 0x1d68a, digit: 0x1d7f6 }
}

export function styleText(text: string, style: TextStyle): string {
  const base = STYLE_BASES[style]
  let out = ''
  for (const char of text) {
    const code = char.charCodeAt(0)
    if (code >= 0x41 && code <= 0x5a) {
      out += String.fromCodePoint(base.upper + code - 0x41)
    } else if (code >= 0x61 && code <= 0x7a) {
      out += String.fromCodePoint(base.lower + code - 0x61)
    } else if (code >= 0x30 && code <= 0x39 && base.digit !== null) {
      out += String.fromCodePoint(base.digit + code - 0x30)
    } else {
      out += char
    }
  }
  return out
}
