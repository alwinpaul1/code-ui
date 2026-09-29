/**
 * Where a fenced code block starts and ends in Markdown source, found line by
 * line before the parser runs, so the HTML pass in
 * mobile-markdown-preview-html.ts can leave its code alone.
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
 * screen raw. So a fence here follows CommonMark's container rules, as marked
 * reads them: it lives in the list item whose content it sits within three
 * columns of, or at the margin, and it ends at its closer or where that item
 * ends.
 */

const LIST_MARKER = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/
const FENCE_RUN = /^(`{3,}|~{3,})(.*)$/

/** Leading spaces and tabs, a tab counted as one column. */
function indentOf(line: string): number {
  let column = 0
  while (line[column] === ' ' || line[column] === '\t') {
    column += 1
  }
  return column
}

/**
 * The content column of the list item a line at `column` sits in, or 0 at the
 * margin. Walks back over blank lines, deeper lines and the item's own
 * continuation lines to the nearest marker line whose content starts at or
 * before `column`; a line at the margin that is not a list item ends the list.
 */
function enclosingItemColumn(lines: readonly string[], index: number, column: number): number {
  if (column === 0) {
    return 0
  }
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const line = lines[cursor] ?? ''
    const indent = indentOf(line)
    if (indent === line.length || indent >= column) {
      continue
    }
    const marker = LIST_MARKER.exec(line)
    if (marker && marker[0].length <= column) {
      return marker[0].length
    }
    if (!marker && indent === 0) {
      return 0
    }
  }
  return 0
}

/** A run of the opener's character at least as long as it, alone on its line,
 *  indented less than four columns into the item. No allocation: this runs on
 *  every line of every fence on every streamed tick. */
function closesFence(line: string, char: string, length: number, container: number): boolean {
  const start = indentOf(line)
  if (start - container >= 4 || line[start] !== char) {
    return false
  }
  let end = line.length
  while (end > start && (line[end - 1] === ' ' || line[end - 1] === '\t')) {
    end -= 1
  }
  if (end - start < length) {
    return false
  }
  for (let cursor = start; cursor < end; cursor += 1) {
    if (line[cursor] !== char) {
      return false
    }
  }
  return true
}

/**
 * When `lines[index]` opens a fence, the index just past it: past its closer,
 * or at the first line that ends its list item, or at the end of the source
 * while it is still streaming. Null when the line opens no fence.
 */
export function markdownFenceEnd(lines: readonly string[], index: number): number | null {
  const line = lines[index] ?? ''
  const marker = LIST_MARKER.exec(line)
  const column = marker ? marker[0].length : indentOf(line)
  const opener = FENCE_RUN.exec(line.slice(column))
  const run = opener?.[1]
  // A backtick fence's info string cannot hold a backtick, as in CommonMark,
  // so a one-line ```code``` span is not taken for one.
  if (!run || (run[0] === '`' && opener[2]?.includes('`'))) {
    return null
  }
  // On its item's marker line the fence starts the item's content; anywhere
  // else, four columns past the content is an indented code block instead.
  const container = marker ? column : enclosingItemColumn(lines, index, column)
  if (column - container >= 4) {
    return null
  }
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const next = lines[cursor] ?? ''
    const indent = indentOf(next)
    if (indent === next.length) {
      continue
    }
    if (indent < container) {
      return cursor
    }
    if (closesFence(next, run[0], run.length, container)) {
      return cursor + 1
    }
  }
  return lines.length
}
