/**
 * Where the fenced code blocks start and end in Markdown source, found line
 * by line before the parser runs, so the HTML pass in
 * mobile-markdown-preview-html.ts can leave their code alone.
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
 * every streamed tick.
 */

/** A list item's marker, then the spaces or tabs before its content. */
const LIST_MARKER = /^[ \t]*(?:[-*+]|\d{1,9}[.)])([ \t]+)/
/** Sticky, so it reads from the text's start without slicing the line. */
const FENCE_RUN = /(`{3,}|~{3,})(.*)$/y

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

/**
 * Every fenced code block in the source, as its first line's index mapped to
 * the index just past it.
 */
export function markdownFenceRanges(lines: readonly string[]): Map<number, number> {
  const ranges = new Map<number, number>()
  // The content columns of the list items still open, innermost last.
  const items: number[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    const start = lineStart(line)
    if (start.index === line.length) {
      index += 1
      continue
    }
    const item = listItemStart(line, start)
    if (item) {
      // A marker closes the items it is not indented into, then opens its own.
      while ((items.at(-1) ?? -1) > item.markerColumn) {
        items.pop()
      }
      items.push(item.contentColumn)
    } else if (start.column === 0) {
      // Text at the margin that is not a list item ends the list. Indented
      // text keeps it open, as a lazy continuation of the item's paragraph.
      items.length = 0
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
      if (!item) {
        // A fence is never a lazy line: it closes every item it is not
        // indented into.
        while ((items.at(-1) ?? -1) > column) {
          items.pop()
        }
      }
      const container = items.at(-1) ?? 0
      // Four columns past its item's content, it is an indented code block.
      if (column - container < 4) {
        const end = fenceEnd(lines, index, run, container)
        ranges.set(index, end)
        index = end
        continue
      }
    }
    index += 1
  }
  return ranges
}
