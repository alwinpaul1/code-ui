export type MarkdownInlineMatch = { 0: string; index: number; end: number }

/** Merge a global non-link regex with links; search starts must advance between calls. */
export function createMarkdownInlineMatcher(
  text: string,
  nonLinkPattern: RegExp,
  images = false,
  /** Find code spans by backtick RUN, as CommonMark does; the regex must
   *  then carry no backtick rule of its own. */
  codeSpans = false
): { lastIndex: number; exec: () => MarkdownInlineMatch | null } {
  let nextOther: MarkdownInlineMatch | null | undefined
  let nextLink: MarkdownInlineMatch | null | undefined
  let nextCode: MarkdownInlineMatch | null | undefined
  /** Every backtick run in the text, found once: [start, length]. */
  let runs: [number, number][] | undefined
  let labelEnd = -1
  let destinationEnd = -1
  let noMoreLabels = false
  let noMoreDestinations = false

  function findLink(from: number): MarkdownInlineMatch | null {
    if (noMoreLabels || noMoreDestinations) {
      return null
    }
    let open = text.indexOf('[', from)
    while (open !== -1) {
      if (labelEnd < open + 1) {
        labelEnd = text.indexOf(']', open + 1)
      }
      if (labelEnd === -1) {
        noMoreLabels = true
        return null
      }
      const image = images && open > from && text[open - 1] === '!'
      if ((image || labelEnd > open + 1) && text[labelEnd + 1] === '(') {
        if (destinationEnd < labelEnd + 2) {
          destinationEnd = text.indexOf(')', labelEnd + 2)
        }
        if (destinationEnd === -1) {
          noMoreDestinations = true
          return null
        }
        if (destinationEnd > labelEnd + 2) {
          const index = image ? open - 1 : open
          return { 0: text.slice(index, destinationEnd + 1), index, end: destinationEnd + 1 }
        }
      }
      // Every opener before this closing bracket shares the same invalid suffix.
      open = text.indexOf('[', labelEnd + 1)
    }
    return null
  }

  /**
   * The next code span at or after `from`, by CommonMark's rule: a run of N
   * backticks opens a span that closes at the next run of EXACTLY N; a run
   * with no such partner is literal text and the scan moves to the run after
   * it. "A backtick, then anything up to the next backtick" was the rule
   * before, and on "`` `user` `` becomes `user`, blank lines…" it paired the
   * wrong backticks and chipped the rest of the paragraph (2026-09-19).
   */
  function findCodeSpan(from: number): MarkdownInlineMatch | null {
    if (runs === undefined) {
      runs = []
      let at = text.indexOf('`')
      while (at !== -1) {
        let length = 1
        while (text[at + length] === '`') {
          length += 1
        }
        runs.push([at, length])
        at = text.indexOf('`', at + length)
      }
    }
    for (let open = 0; open < runs.length; open += 1) {
      const [start, length] = runs[open]!
      if (start < from) {
        continue
      }
      for (let close = open + 1; close < runs.length; close += 1) {
        const [closeStart, closeLength] = runs[close]!
        if (closeLength === length) {
          const end = closeStart + closeLength
          return { 0: text.slice(start, end), index: start, end }
        }
      }
    }
    return null
  }

  const matcher = {
    lastIndex: 0,
    exec(): MarkdownInlineMatch | null {
      const from = matcher.lastIndex
      if (nextOther === undefined || (nextOther !== null && nextOther.index < from)) {
        nonLinkPattern.lastIndex = from
        const match = nonLinkPattern.exec(text)
        nextOther = match ? { 0: match[0], index: match.index, end: nonLinkPattern.lastIndex } : null
      }
      if (nextLink === undefined || (nextLink !== null && nextLink.index < from)) {
        nextLink = findLink(from)
      }
      if (codeSpans && (nextCode === undefined || (nextCode !== null && nextCode.index < from))) {
        nextCode = findCodeSpan(from)
      }
      // A code span binds tighter than emphasis (CommonMark): a token that
      // opens before one and closes INSIDE it is not a token. Look again from
      // just past its opener, until the next candidate clears the span. One
      // that closes after the span contains it and stands — the first cut of
      // this dropped "**Alphabetical `/` menu.**" and left the stars literal
      // beside the chip (device, 2026-09-20).
      while (
        codeSpans &&
        nextCode &&
        nextOther &&
        nextOther.index < nextCode.index &&
        nextOther.end > nextCode.index &&
        nextOther.end < nextCode.end
      ) {
        nonLinkPattern.lastIndex = nextOther.index + 1
        const again = nonLinkPattern.exec(text)
        nextOther = again ? { 0: again[0], index: again.index, end: nonLinkPattern.lastIndex } : null
      }
      let match =
        nextLink && (!nextOther || nextLink.index < nextOther.index) ? nextLink : nextOther
      // Earliest wins; on a tie the code span, since a backtick is never an
      // emphasis or link opener.
      if (codeSpans && nextCode && (!match || nextCode.index <= match.index)) {
        match = nextCode
      }
      if (match) {
        matcher.lastIndex = match.end
      }
      return match
    }
  }
  return matcher
}

/** The text of a code-span token: the backtick runs off, then one space of
 *  padding off each side when both are there and the span is not all spaces
 *  (CommonMark), so `` ` `` `user` `` `` reads `user` and ``` `  two  ` ```
 *  keeps one space each side. */
export function codeSpanContent(token: string): string {
  let run = 0
  while (token[run] === '`') {
    run += 1
  }
  const inner = token.slice(run, token.length - run)
  if (inner.length >= 2 && inner.startsWith(' ') && inner.endsWith(' ') && inner.trim().length > 0) {
    return inner.slice(1, -1)
  }
  return inner
}
