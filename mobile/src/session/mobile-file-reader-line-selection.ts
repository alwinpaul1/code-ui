// Pure state for the file reader's line-selection mode (VS Code's Alt+K
// parity): long-press a line to start, tap another to extend. Kept apart from
// the component so the anchor/focus math and the degenerate sizes (one line,
// a line tapped onto itself) are provable without rendering anything.

/** `anchor` is the long-pressed line; `focus` is wherever the selection was
 *  last extended to (may be before or after the anchor). `null` means no
 *  selection is active. Line numbers are 1-based, matching the gutter. */
export type FileReaderLineSelection = { anchor: number; focus: number } | null

export type FileReaderLineRange = { start: number; end: number }

/** Long-press on `line` starts (or restarts) a one-line selection there. */
export function startFileReaderLineSelection(line: number): FileReaderLineSelection {
  return { anchor: line, focus: line }
}

/** A tap on `line` while selecting moves the free end there; the anchor
 *  never moves. Extending with no active selection behaves like starting
 *  one — a defensive fallback, since the view only wires this up while a
 *  selection already exists. */
export function extendFileReaderLineSelection(
  selection: FileReaderLineSelection,
  line: number
): FileReaderLineSelection {
  if (!selection) {
    return startFileReaderLineSelection(line)
  }
  return { anchor: selection.anchor, focus: line }
}

/** The selection as an ordered `{ start, end }` (`start <= end`), or `null`
 *  with nothing selected. */
export function fileReaderLineSelectionRange(
  selection: FileReaderLineSelection
): FileReaderLineRange | null {
  if (!selection) {
    return null
  }
  return selection.anchor <= selection.focus
    ? { start: selection.anchor, end: selection.focus }
    : { start: selection.focus, end: selection.anchor }
}

/** Whether `line` falls inside the current selection, inclusive of both ends. */
export function isFileReaderLineSelected(selection: FileReaderLineSelection, line: number): boolean {
  const range = fileReaderLineSelectionRange(selection)
  return range != null && line >= range.start && line <= range.end
}

/** Action-bar copy for the current range: "Ask about line 10" for one line,
 *  "Ask about lines 10–20" for a span. */
export function fileReaderLineSelectionLabel(range: FileReaderLineRange): string {
  return range.start === range.end
    ? `Ask about line ${range.start}`
    : `Ask about lines ${range.start}–${range.end}`
}
