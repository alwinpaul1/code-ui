/**
 * Where the code blocks start and end in Markdown source, found line by line
 * before the parser runs, so the HTML pass in mobile-markdown-preview-html.ts
 * can leave their code alone.
 *
 * Only a fence at the margin, opened by exactly three backticks and a bare
 * word, was found before. A fence under a list item (the commonest one an
 * agent writes), one with tildes or a longer run, and one with a title in its
 * info string went through the HTML pass: `<Text>` and `&amp;` were stripped
 * out of the code and blank lines squeezed, and the chat's Copy button put
 * what was left on the clipboard (review, 2026-09-29). Taking every fence run
 * for a fence overshot the other way (second review, same day): an indented
 * code block holding a fence run, or a list fence the next item had already
 * ended, kept a protected region open, and the HTML after it reached the
 * screen raw. So a fence here follows CommonMark's containers as marked reads
 * them: it lives in the list item whose content it sits within three columns
 * of, or at the margin, and it ends at its closer or where that item ends.
 *
 * One pass, forward: the open list items are tracked as the lines go by.
 * Walking back to find each fence's item read the document once per fence
 * (third review, same day: 2,004,002 line reads for a 4,002-line reply), on
 * every streamed tick. Whether the line before was paragraph text is tracked
 * too, because CommonMark lets such a line's next one continue it lazily
 * (fourth review): a line at the margin right after an item's text is still
 * that item's, and a line four columns in is still that paragraph's.
 *
 * An indented code block is code as well, and it went through the HTML pass
 * in every version before this: `    <div>x</div>` drew and copied as `x`.
 *
 * A quote is a container too, and a `>` line was read as paragraph text, so a
 * fence inside a quote went through the HTML pass the way a list fence had:
 * `<b>x</b>` drew and copied as `**x**`, and `<Text>a</Text>` as `a` (review,
 * 2026-09-30). A quote's lines, markers off, are now read as a document of
 * their own, as marked reads them, and whatever code is found there is
 * protected where it sits. The quote ends at its first line without a
 * marker, and so does any fence left open in it: a line that leaves the
 * quote is never code of a fence inside it.
 */

/** A list item's marker, then the spaces or tabs before its content. */
const LIST_MARKER = /^[ \t]*(?:[-*+]|\d{1,9}[.)])([ \t]+)/
/** Sticky, so it reads from the text's start without slicing the line. */
const FENCE_RUN = /(`{3,}|~{3,})(.*)$/y
/** `---`, `* * *`, `___`: a rule, which `- - -` must not be read as an item. */
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
/** An ATX heading, read where a line's (or an item's) text starts. */
const ATX_HEADING = /#{1,6}(?:[ \t]|$)/y
/**
 * What marked (18.0.12) never takes for a lazy line of a list item, besides
 * the fences, quotes, items and rules read below: a line opening with `#`,
 * heading or not (`#hashtag` too), read where its text starts. Any item that
 * line is not indented into ends at it. A heading right after an item's words
 * was taken for a lazy line of them before, which kept the list open, and an
 * indented block after it was taken for the item's paragraph: `<b>x</b>` in
 * it drew and copied as `**x**` (review, 2026-09-30).
 *
 * marked ends an item at a line opening with a tag too, but it never sees
 * one: the HTML pass these ranges are for has already removed `<div>` and
 * `<!-- -->` lines (blank now, so the item goes on past them) and turned
 * `<b>x</b>` into `**x**` (a lazy line). Ending the item there protected the
 * paragraph after it, and its tags were drawn raw.
 */
const ENDS_LIST_ITEM = /#/y
/**
 * How many quotes deep their fences are looked for. Each level reads its
 * quote's lines once more, so a document of nothing but `> > > …` would cost
 * a pass per marker; past this depth a quote's lines are paragraph text, as
 * every quote's were before. The parser refuses 200 levels outright
 * (RUNAWAY_NESTING in mobile-markdown-parser.ts), and no reply nests near 32.
 */
const QUOTE_DEPTH_LIMIT = 32

/** The column after `text` read from `column`, a tab moving to the next
 *  multiple of four as CommonMark expands it (marked does the same). */
function advanceColumn(text: string, column: number): number {
  let next = column
  for (const char of text) {
    next = char === '\t' ? next + 4 - (next % 4) : next + 1
  }
  return next
}

/** Where a line's text starts: its index, and its column with tabs expanded. */
function lineStart(line: string): { index: number; column: number } {
  let index = 0
  let column = 0
  while (line[index] === ' ' || line[index] === '\t') {
    column = line[index] === '\t' ? column + 4 - (column % 4) : column + 1
    index += 1
  }
  return { index, column }
}

type ListItemStart = {
  /** Where the marker sits. */
  markerColumn: number
  /** Where the item's content lines up. */
  contentColumn: number
  /** Where the text on the marker line starts: its index and its column. */
  textIndex: number
  textColumn: number
}

function listItemStart(line: string, start: { index: number; column: number }): ListItemStart | null {
  // Most lines start with a letter; only these characters can open an item.
  const first = line[start.index] ?? ''
  if (first !== '-' && first !== '*' && first !== '+' && !(first >= '0' && first <= '9')) {
    return null
  }
  const marker = LIST_MARKER.exec(line)
  if (!marker) {
    return null
  }
  const markerColumn = start.column
  const gap = marker[1] ?? ''
  // The marker itself (`-`, `10.`) holds no tab: one column per character.
  const afterMarker = markerColumn + marker[0].length - gap.length - start.index
  const textColumn = advanceColumn(gap, afterMarker)
  // Five or more columns after the marker are one column of gap and an
  // indented code block, as in CommonMark.
  const contentColumn = textColumn - afterMarker >= 5 ? afterMarker + 1 : textColumn
  return { markerColumn, contentColumn, textIndex: marker[0].length, textColumn }
}

/** A run of the opener's character at least as long as it, alone on its line,
 *  less than four columns into the item. Allocates nothing: it runs on every
 *  line of every fence on every streamed tick. */
function closesFence(line: string, char: string, length: number, container: number): boolean {
  const start = lineStart(line)
  if (start.column - container >= 4 || line[start.index] !== char) {
    return false
  }
  let end = line.length
  while (end > start.index && (line[end - 1] === ' ' || line[end - 1] === '\t')) {
    end -= 1
  }
  if (end - start.index < length) {
    return false
  }
  for (let cursor = start.index; cursor < end; cursor += 1) {
    if (line[cursor] !== char) {
      return false
    }
  }
  return true
}

/** The index just past the fence opened at `index`: past its closer, at the
 *  first line that ends its list item, or at the end while it streams. */
function fenceEnd(lines: readonly string[], index: number, run: string, container: number): number {
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor] ?? ''
    const start = lineStart(line)
    if (start.index === line.length) {
      continue
    }
    if (start.column < container) {
      return cursor
    }
    if (closesFence(line, run[0] ?? '`', run.length, container)) {
      return cursor + 1
    }
  }
  return lines.length
}

/** The index just past the indented code block starting at `index`: past
 *  its last line four columns into its item, before the text after it. */
function indentedCodeEnd(lines: readonly string[], index: number, container: number): number {
  let end = index + 1
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor] ?? ''
    const start = lineStart(line)
    if (start.index === line.length) {
      continue
    }
    if (start.column - container < 4) {
      break
    }
    end = cursor + 1
  }
  return end
}

/** A line of the quote whose marker sits `container` to three columns in,
 *  as the quote's own text: the indent, the `>` and the one space or tab
 *  after it off, as marked takes them. Null for a line that is not the
 *  quote's. */
function quotedLine(line: string, container: number): string | null {
  const start = lineStart(line)
  if (line[start.index] !== '>' || start.column < container || start.column - container >= 4) {
    return null
  }
  const after = start.index + 1
  return line.slice(line[after] === ' ' || line[after] === '\t' ? after + 1 : after)
}

export type MarkdownCodeRangeOptions = {
  /**
   * Indented code blocks as well as fences. Only for a whole document: a
   * fragment the HTML pass cuts out of a paragraph tag has lost the line
   * before it, and would read the README's indented `<img>` as code.
   */
  indentedCode?: boolean
}

/**
 * Every code block in the source, as its first line's index mapped to the
 * index just past it: fences, and indented blocks when asked for.
 */
export function markdownCodeRanges(
  lines: readonly string[],
  options: MarkdownCodeRangeOptions = {}
): Map<number, number> {
  const ranges = new Map<number, number>()
  codeRanges(lines, options, 0, ranges, 0, false)
  return ranges
}

/** What a run of lines ends in, for the line after it: nothing a lazy line
 *  can continue, a paragraph, or a paragraph inside a list item. */
type Ending = 'none' | 'paragraph' | 'item'

/**
 * Adds the code blocks in `lines` to `ranges`, each index moved by `offset`
 * (where these lines sit in the document), and says what the last line
 * leaves open for the line after it. A quote whose last line is a fence, a
 * heading, a blank `>` or indented code leaves nothing to continue, so an
 * indented line after it is code, as marked reads it. It was taken for the
 * quote's paragraph, and the HTML pass drew and copied `<b>x</b>` there as
 * `**x**` (review, 2026-09-30).
 */
function codeRanges(
  lines: readonly string[],
  options: MarkdownCodeRangeOptions,
  /** How many quotes these lines sit inside. */
  quoteDepth: number,
  ranges: Map<number, number>,
  offset: number,
  /** The first line may continue a paragraph: the quote these lines are
   *  the rest of had one open, carried over lazy lines. */
  continuesParagraph: boolean
): Ending {
  // The content columns of the list items still open, innermost last.
  const items: number[] = []
  const closeItemsPast = (column: number): void => {
    while ((items.at(-1) ?? -1) > column) {
      items.pop()
    }
  }
  // The content column of the innermost open item a line at `column` sits
  // in, without closing the ones it does not: a lazy line leaves them open.
  const innermostItemAt = (column: number): number => {
    for (let depth = items.length - 1; depth >= 0; depth -= 1) {
      const content = items[depth] ?? 0
      if (content <= column) {
        return content
      }
    }
    return 0
  }
  // The line before was paragraph text, so an indented or outdented line
  // continues that paragraph (a lazy line) instead of starting a block.
  let inParagraph = continuesParagraph
  // A quote's paragraph is still open over the lazy lines after it, so a
  // quote line after them is the same quote, its paragraph still going.
  let quoteParagraphOpen = false
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    const start = lineStart(line)
    const lazyAfterQuote: boolean = quoteParagraphOpen
    quoteParagraphOpen = false
    if (start.index === line.length) {
      inParagraph = false
      index += 1
      continue
    }
    if (!inParagraph) {
      // Not a lazy line: it leaves every item it is not indented into.
      closeItemsPast(start.column)
      const container = items.at(-1) ?? 0
      if (start.column - container >= 4) {
        // Its lines are code whether or not they are protected: none of
        // them opens a fence or an item.
        const end = indentedCodeEnd(lines, index, container)
        if (options.indentedCode) {
          ranges.set(offset + index, offset + end)
        }
        index = end
        continue
      }
    }
    if (inParagraph && start.column - innermostItemAt(start.column) >= 4) {
      // Four columns past its item right after paragraph text: that
      // paragraph's next line, whatever it looks like.
      quoteParagraphOpen = lazyAfterQuote
      index += 1
      continue
    }
    if (line[start.index] === '>' && quoteDepth < QUOTE_DEPTH_LIMIT) {
      // A quote marker is never a lazy line: it closes every item it is not
      // indented into, and its quote runs to the first line without one.
      closeItemsPast(start.column)
      const container = items.at(-1) ?? 0
      const quoted: string[] = []
      let cursor = index
      while (cursor < lines.length) {
        const text = quotedLine(lines[cursor] ?? '', container)
        if (text === null) {
          break
        }
        quoted.push(text)
        cursor += 1
      }
      // The quote's code sits on the same lines, and ends inside the quote.
      // What follows may continue its last paragraph lazily, if it ended in
      // one. marked carries that paragraph on into the quote lines after the
      // lazy ones only when it is the quote's own, not a list item's in it.
      const ending = codeRanges(quoted, options, quoteDepth + 1, ranges, offset + index, lazyAfterQuote && inParagraph)
      inParagraph = ending !== 'none'
      quoteParagraphOpen = ending === 'paragraph'
      index = cursor
      continue
    }
    if (THEMATIC_BREAK.test(line)) {
      // `- - -` is a rule, not a list item holding `- -`.
      closeItemsPast(start.column)
      inParagraph = false
      index += 1
      continue
    }
    const item = listItemStart(line, start)
    if (item) {
      // A marker closes the items it is not indented into, then opens its own.
      closeItemsPast(item.markerColumn)
      items.push(item.contentColumn)
      if (item.textColumn - item.contentColumn >= 4 && item.textIndex < line.length) {
        // Five columns of gap: the item starts with an indented code block.
        const end = indentedCodeEnd(lines, index, item.contentColumn)
        if (options.indentedCode) {
          ranges.set(offset + index, offset + end)
        }
        inParagraph = false
        index = end
        continue
      }
    } else if (inParagraph) {
      ENDS_LIST_ITEM.lastIndex = start.index
      if (ENDS_LIST_ITEM.test(line)) {
        closeItemsPast(start.column)
      }
    }
    const textIndex = item ? item.textIndex : start.index
    const column = item ? item.textColumn : start.column
    const lead = line[textIndex]
    FENCE_RUN.lastIndex = textIndex
    const opener = lead === '`' || lead === '~' ? FENCE_RUN.exec(line) : null
    const run = opener?.[1]
    // A backtick fence's info string cannot hold a backtick, as in
    // CommonMark, so a one-line ```code``` span is not taken for one.
    if (run && !(run[0] === '`' && opener[2]?.includes('`'))) {
      // A fence is never a lazy line: it closes every item it is not
      // indented into. Four columns past its item's content it is not a
      // fence: an indented code block, or the paragraph's next line.
      const container = item ? item.contentColumn : innermostItemAt(column)
      if (column - container < 4) {
        closeItemsPast(column)
        const end = fenceEnd(lines, index, run, container)
        ranges.set(offset + index, offset + end)
        inParagraph = false
        index = end
        continue
      }
    }
    // Text: a heading ends where it starts, anything else is a paragraph
    // (or an HTML block, which also runs to the next blank line). An item's
    // heading is read from its words: `- # H` holds no paragraph either.
    ATX_HEADING.lastIndex = textIndex
    inParagraph = !ATX_HEADING.test(line) && textIndex < line.length
    // A lazy line of a quote's paragraph keeps it open; an item interrupts
    // it. So does a line opening with a tag, which may be blank by the time
    // marked reads it (`</div>`): the quote after it starts afresh, and an
    // indented line in it stays protected rather than risk its code.
    quoteParagraphOpen = lazyAfterQuote && !item && inParagraph && line[start.index] !== '<'
    index += 1
  }
  return !inParagraph ? 'none' : items.length > 0 ? 'item' : 'paragraph'
}
