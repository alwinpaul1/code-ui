// Residual inline HTML in a PR comment body, and the code spans it must not
// reach.

/** Removes residual HTML tags from rendered text so stray <b>/<kbd>/<sub> etc. don't
 *  show literally. Conservative: only matches `<tag ...>` / `</tag>` shapes, so a bare
 *  "a < b" in prose is left alone. Code is not protected here: see
 *  stripHtmlTagsOutsideCode. */
export function stripHtmlTags(text: string): string {
  const end = text.lastIndexOf('>') + 1
  if (end === 0) {
    return text
  }
  // No tag can close in this suffix; keep it literal without retrying every opener.
  return (
    text.slice(0, end).replace(/<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^>]*)?\/?>/g, '') + text.slice(end)
  )
}

/**
 * The code spans in `text`, read by the rule the inline matcher uses
 * (findCodeSpan in markdown-inline-matcher.ts): a run of N backticks opens a
 * span that closes at the next run of exactly N, and a run with no such
 * partner is text. If that rule changes, this must follow.
 *
 * The reader returns the first span that opens at or after `from`, as
 * [start, end). Asked with a `from` that never goes back, the whole text
 * costs one pass: each run's next partner is found once, walking back from
 * the end. The matcher looks for each span from the first run again, which
 * costs 861 ms for 20,000 spans; this must not add another such pass.
 *
 * A `from` past text the caller took out (an HTML comment) reads the rest as
 * if that text were gone: a span's partner always lies after its opener, so
 * a run before `from` is never anyone's partner.
 */
export function codeSpanReader(text: string): (from: number) => [number, number] | null {
  const starts: number[] = []
  const lengths: number[] = []
  for (let at = text.indexOf('`'); at !== -1; ) {
    let length = 1
    while (text[at + length] === '`') {
      length += 1
    }
    starts.push(at)
    lengths.push(length)
    at = text.indexOf('`', at + length)
  }
  const partners: number[] = []
  const nextOfLength = new Map<number, number>()
  for (let run = starts.length - 1; run >= 0; run -= 1) {
    partners[run] = nextOfLength.get(lengths[run]!) ?? -1
    nextOfLength.set(lengths[run]!, run)
  }
  let run = 0
  return (from) => {
    while (run < starts.length && (starts[run]! < from || partners[run] === -1)) {
      run += 1
    }
    if (run === starts.length) {
      return null
    }
    const partner = partners[run]!
    return [starts[run]!, starts[partner]! + lengths[partner]!]
  }
}

/** Every code span in `text`, as [start, end) in order (codeSpanReader). */
export function codeSpanRanges(text: string): [number, number][] {
  const next = codeSpanReader(text)
  const ranges: [number, number][] = []
  for (let span = next(0); span; span = next(span[1])) {
    ranges.push(span)
  }
  return ranges
}

/**
 * stripHtmlTags over the text between code spans only: a code span keeps its
 * text exactly. Stripping the whole string first turned `Array<string>` into
 * the chip "Array" and `<div>` into an empty one (review, 2026-09-30). The
 * chat's HTML pass protects code first the same way (protectMarkdownCode).
 *
 * Code wins where a tag and a code span overlap: a tag whose attribute holds
 * a backtick that pairs with another is cut in two and left as text, where
 * CommonMark gives the overlap to whichever starts first. That takes a tag
 * with a backtick inside its attribute, which is rare in a comment; a generic
 * type in backticks is not.
 */
export function stripHtmlTagsOutsideCode(text: string): string {
  if (!text.includes('`')) {
    return stripHtmlTags(text)
  }
  let out = ''
  let at = 0
  for (const [start, end] of codeSpanRanges(text)) {
    out += stripHtmlTags(text.slice(at, start)) + text.slice(start, end)
    at = end
  }
  return out + stripHtmlTags(text.slice(at))
}
