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
 * Every code span in `text`, as [start, end) in order, by the rule the inline
 * matcher reads them with (findCodeSpan in markdown-inline-matcher.ts): a run
 * of N backticks opens a span that closes at the next run of exactly N, and a
 * run with no such partner is text. If that rule changes, this must follow.
 *
 * Linear: each run's next partner is found once, walking back from the end.
 * The matcher looks for the next span from the first run every time it is
 * asked, which costs 861 ms for 20,000 spans; this pass must not add another.
 */
export function codeSpanRanges(text: string): [number, number][] {
  const runs: [number, number][] = []
  for (let at = text.indexOf('`'); at !== -1; ) {
    let length = 1
    while (text[at + length] === '`') {
      length += 1
    }
    runs.push([at, length])
    at = text.indexOf('`', at + length)
  }
  const partners: number[] = []
  const nextOfLength = new Map<number, number>()
  for (let run = runs.length - 1; run >= 0; run -= 1) {
    const length = runs[run]![1]
    partners[run] = nextOfLength.get(length) ?? -1
    nextOfLength.set(length, run)
  }
  const ranges: [number, number][] = []
  let run = 0
  while (run < runs.length) {
    const partner = partners[run]!
    if (partner === -1) {
      run += 1
      continue
    }
    const [closeStart, closeLength] = runs[partner]!
    ranges.push([runs[run]![0], closeStart + closeLength])
    run = partner + 1
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
