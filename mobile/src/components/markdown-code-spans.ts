/**
 * Code spans by CommonMark's rule, for the inline matcher
 * (markdown-inline-matcher.ts) and for the HTML pass
 * (mobile-markdown-preview-html.ts), which has to leave a span's text alone
 * exactly where the screen will draw one. The pass had a rule of its own, a
 * backtick and anything up to the next backtick on the same line, so
 * `` `<b>x `` / `` y</b>` ``, a span across a soft line break, had its tags
 * rewritten to `**x y**` before the screen drew the span (review,
 * 2026-09-30). A two-backtick span holding a backtick was only right by luck.
 *
 * A run of N backticks opens a span that closes at the next run of EXACTLY
 * N; a run with no such partner is literal text and the scan moves to the run
 * after it. "A backtick, then anything up to the next backtick" was the
 * matcher's rule before, and on "`` `user` `` becomes `user`, blank lines…"
 * it paired the wrong backticks and chipped the rest of the paragraph
 * (2026-09-19). With `escapes`, a run right after an odd run of backslashes opens
 * with one backtick fewer, that one literal (`` \`not code` `` is no span).
 * Only an opener: a backslash inside a span is literal, so `` `a\` `` closes.
 * Each run's partner is found ahead of time in one pass from the end, so a
 * paragraph full of backticks stays linear. Every call's `from` must be past
 * the span the call before it found.
 */

export type MarkdownCodeSpan = { index: number; end: number }

/** Whether an odd run of backslashes ends just before `index`. */
function escapedAt(text: string, index: number): boolean {
  let slashes = 0
  while (text[index - 1 - slashes] === '\\') {
    slashes += 1
  }
  return slashes % 2 === 1
}

type Runs = {
  starts: number[]
  lengths: number[]
  /** The next run of the same length, or -1. */
  partner: Int32Array
  /** The next run one backtick shorter, the partner of an escaped opener. */
  shorterPartner: Int32Array
}

function backtickRuns(text: string): Runs {
  const starts: number[] = []
  const lengths: number[] = []
  let at = text.indexOf('`')
  while (at !== -1) {
    let length = 1
    while (text[at + length] === '`') {
      length += 1
    }
    starts.push(at)
    lengths.push(length)
    at = text.indexOf('`', at + length)
  }
  const partner = new Int32Array(starts.length).fill(-1)
  const shorterPartner = new Int32Array(starts.length).fill(-1)
  const nextOfLength = new Map<number, number>()
  for (let run = starts.length - 1; run >= 0; run -= 1) {
    const length = lengths[run]!
    partner[run] = nextOfLength.get(length) ?? -1
    shorterPartner[run] = nextOfLength.get(length - 1) ?? -1
    nextOfLength.set(length, run)
  }
  return { starts, lengths, partner, shorterPartner }
}

export function createMarkdownCodeSpanFinder(
  text: string,
  escapes: boolean
): (from: number) => MarkdownCodeSpan | null {
  let runs: Runs | undefined
  // The first run a later call can open at.
  let cursor = 0
  return (from) => {
    runs ??= backtickRuns(text)
    const { starts, lengths, partner, shorterPartner } = runs
    for (let open = cursor; open < starts.length; open += 1) {
      // Behind `from` even with a backtick taken off: no need to count.
      if (starts[open]! + 1 < from) {
        continue
      }
      const escaped = escapes && escapedAt(text, starts[open]!)
      const start = starts[open]! + (escaped ? 1 : 0)
      // An escaped single backtick opens nothing: no run is zero long.
      const close = escaped ? shorterPartner[open]! : partner[open]!
      if (start < from || close === -1) {
        continue
      }
      cursor = open
      return { index: start, end: starts[close]! + lengths[close]! }
    }
    cursor = starts.length
    return null
  }
}

/** Every code span in `text` that opens at or after `from`, in order. */
export function markdownCodeSpans(text: string, escapes: boolean, from = 0): MarkdownCodeSpan[] {
  const find = createMarkdownCodeSpanFinder(text, escapes)
  const spans: MarkdownCodeSpan[] = []
  let span = find(from)
  while (span) {
    spans.push(span)
    span = find(span.end)
  }
  return spans
}

/**
 * `text` with every character of each code span from `from` on swapped for
 * `standIn`, backticks too, except whitespace; the same length, so every
 * index still lines up. A pattern scanning it cannot take a star inside a
 * span for emphasis (markdown-inline-matcher.ts). Whitespace stays, so what
 * a space ends, a bare address or an emphasis's edge, still ends there.
 */
export function maskMarkdownCodeSpans(
  text: string,
  escapes: boolean,
  from: number,
  standIn: string
): { masked: string; spans: MarkdownCodeSpan[] } {
  const spans = markdownCodeSpans(text, escapes, from)
  if (spans.length === 0) {
    return { masked: text, spans }
  }
  let masked = ''
  let at = 0
  for (const span of spans) {
    masked += text.slice(at, span.index) + text.slice(span.index, span.end).replace(/\S/g, standIn)
    at = span.end
  }
  return { masked: masked + text.slice(at), spans }
}
