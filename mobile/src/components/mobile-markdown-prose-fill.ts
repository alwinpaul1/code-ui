import { inlineBreaksAsLines } from './markdown-inline-breaks'
import { markdownCodeSpans } from './markdown-code-spans'

// How a paragraph's soft newlines are drawn, out of mobile-markdown-parser.ts:
// filled to the width at the top of a document, broken inside a quote.

/** How many backslashes a line ends with. Only an ODD run ends in an
 *  UNESCAPED one, and only an unescaped one is a hard break: `C:\\` at the end
 *  of a line is an escaped backslash followed by a soft break, which
 *  CommonMark renders as a space. */
function trailingBackslashes(line: string): number {
  let count = 0
  while (count < line.length && line[line.length - 1 - count] === '\\') {
    count += 1
  }
  return count
}

/** Fill prose to the phone's width: a soft newline becomes a space, and the two
 *  deliberate hard breaks (two trailing spaces, an unescaped trailing
 *  backslash) stay. Line by line rather than by regex, because telling an
 *  escaped backslash from an unescaped one means counting the run. */
export function reflowProse(value: string): string {
  const lines = value.split('\n')
  let filled = ''
  for (let index = 0; index < lines.length; index += 1) {
    const line = index > 0 ? lines[index]!.replace(/^[ \t]+/, '') : lines[index]!
    if (index === lines.length - 1) {
      filled += line.replace(/[ \t]+$/, '')
      break
    }
    if (trailingBackslashes(line) % 2 === 1) {
      filled += `${line.slice(0, -1)}\n`
    } else if (/ {2,}$/.test(line)) {
      filled += `${line.replace(/[ \t]+$/, '')}\n`
    } else {
      filled += `${line.replace(/[ \t]+$/, '')} `
    }
  }
  // A `<br>` the HTML pass kept for a list item, a quote or a heading, or for
  // a table row that marked read as prose, is a line break here, and two a
  // gap inside the block (markdown-inline-breaks.ts).
  return inlineBreaksAsLines(filled.trim())
}

/**
 * Prose inside a quote: every newline is a line break, as the Claude app draws
 * a quote (an email draft, 2026-10-10: "My details:" and a detail per line,
 * and "Best regards," over the name, all soft newlines in the source).
 *
 * Decided 2026-10-10: only inside a quote. Outside one the phone still fills
 * prose to its width (reflowProse), because the 80-column hard-wrapped
 * documents that made the parser reflow (mobile-markdown-wrapped-source.test.ts)
 * are prose, not quotes; a quote is where an agent puts text whose lines mean
 * something: a letter, an address, a sign-off, a verse. Orca's desktop breaks
 * every newline everywhere (remark-breaks), so a quote here now reads as it
 * does there. The price: a hard-wrapped quote in a document draws ragged at 40
 * columns, as it would on the desktop at its own width.
 *
 * The two hard breaks a writer can spell are breaks either way, and lose their
 * marks: two trailing spaces, an unescaped trailing backslash. A newline inside
 * a code span is still a space, as CommonMark reads it: the span's text runs on.
 */
export function breakProse(value: string): string {
  const spans = value.includes('`') && value.includes('\n') ? markdownCodeSpans(value, true) : []
  const lines = value.split('\n')
  let broken = ''
  let at = 0
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]!
    let line = index > 0 ? raw.replace(/^[ \t]+/, '') : raw
    if (index === lines.length - 1) {
      broken += line.replace(/[ \t]+$/, '')
      break
    }
    const newline = at + raw.length
    at = newline + 1
    if (spans.some((span) => span.index < newline && newline < span.end)) {
      broken += `${line.replace(/[ \t]+$/, '')} `
      continue
    }
    if (trailingBackslashes(line) % 2 === 1) {
      line = line.slice(0, -1)
    }
    broken += `${line.replace(/[ \t]+$/, '')}\n`
  }
  return inlineBreaksAsLines(broken.trim())
}
