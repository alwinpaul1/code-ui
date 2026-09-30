import type { MobileDiffLine } from './mobile-diff-lines'
import { collapsedDiffRow, noNewlineDiffRow, truncatedDiffRow } from './mobile-diff-notes'
import type { DiffSegment } from './mobile-diff-segments'

export const MAX_MOBILE_DIFF_LINES = 2_500
/** Unchanged rows kept on each side of a change when a long diff is folded, as unified diff does
 *  (and ANCHOR_CONTEXT_ROWS in mobile-diff-hunk-revert.ts). */
const CONTEXT_ROWS = 3

/**
 * Turns aligned runs into preview rows under the mobile cap of MAX_MOBILE_DIFF_LINES.
 *
 * A diff that fits is drawn whole, every unchanged row included, exactly as before. One that does
 * not first folds each unchanged run down to CONTEXT_ROWS beside each change and one "N unchanged
 * lines" row, so the rows before the first change are at most CONTEXT_ROWS plus that one: the cap
 * can no longer spend itself on unchanged rows and cut before the change (a 3,000-line file changed
 * on line 2,900 used to draw 2,500 unchanged rows and nothing else). Only if a changed row of the
 * folded diff is still past the cap is it cut, and the last row then says which changed rows it
 * left out: truncated means a changed row is not shown, and nothing else.
 *
 * The cap counts the file's rows and the fold's "N unchanged lines" rows up to the last change. Two
 * kinds of row ride past it, never both at once (the first needs an unchanged last line on each
 * side, the second a changed one):
 * - The unchanged run after the last change, folded as any other (so at most CONTEXT_ROWS + 1
 *   rows), is drawn whenever that change is and never after a cut one, so the end of the file is
 *   still accounted for. Counted, it was the row the cap refused when the changes ended at or near
 *   the cap: every change drawn, and "truncated" said anyway (review, 2026-09-30).
 * - git's "\ No newline at end of file" rides with the changed row above it, drawn whenever that
 *   row is and never on its own (at most two), so a note can neither push out the last changed
 *   row nor be the row the cap refuses. Counted, it cut a replaced block of exactly 2,500 rows, or
 *   said it was truncated with nothing left out (review, 2026-09-30).
 */
export function emitMobileDiffRows(
  segments: readonly DiffSegment[],
  oldLines: readonly string[],
  newLines: readonly string[],
  // A side whose last line has no newline: its row, when changed, is followed by git's
  // "\ No newline at end of file".
  ends: { oldUnterminated: boolean; newUnterminated: boolean } = {
    oldUnterminated: false,
    newUnterminated: false
  }
): { lines: MobileDiffLine[]; truncated: boolean } {
  const total = segments.reduce((sum, segment) => sum + segment.length, 0)
  const fold = total > MAX_MOBILE_DIFF_LINES
  const lines: MobileDiffLine[] = []
  // The rows the cap counts: every row but the no-newline notes and the run after the last change.
  let counted = 0
  let hiddenAdded = 0
  let hiddenDeleted = 0
  /** Draws a row, or refuses a counted one once the cap is full; every later counted row is then
   *  refused too, so a refused unchanged row is always followed by a refused change. */
  const push = (line: MobileDiffLine, counts: boolean): boolean => {
    if (counts && counted >= MAX_MOBILE_DIFF_LINES) {
      return false
    }
    lines.push(line)
    counted += counts ? 1 : 0
    return true
  }
  const pushContext = (
    segment: Extract<DiffSegment, { kind: 'context' }>,
    from: number,
    to: number,
    counts: boolean
  ): void => {
    for (let offset = from; offset < to; offset += 1) {
      const oldIndex = segment.oldStart + offset
      if (
        !push(
          {
            kind: 'context',
            text: oldLines[oldIndex] ?? '',
            oldLineNumber: oldIndex + 1,
            newLineNumber: segment.newStart + offset + 1
          },
          counts
        )
      ) {
        return
      }
    }
  }

  segments.forEach((segment, index) => {
    if (segment.kind === 'context') {
      const afterLastChange = index > 0 && index === segments.length - 1
      // After a cut change the cut row ends the preview; after a drawn one, the run is uncounted.
      if (afterLastChange && hiddenAdded + hiddenDeleted > 0) {
        return
      }
      const counts = !afterLastChange
      const head = index === 0 ? 0 : CONTEXT_ROWS
      const tail = index === segments.length - 1 ? 0 : CONTEXT_ROWS
      const hidden = segment.length - head - tail
      // Folding one row into a row that says "1 unchanged line" hides nothing.
      if (!fold || hidden < 2) {
        pushContext(segment, 0, segment.length, counts)
        return
      }
      pushContext(segment, 0, head, counts)
      push(collapsedDiffRow(hidden), counts)
      pushContext(segment, segment.length - tail, segment.length, counts)
      return
    }
    for (let offset = 0; offset < segment.length; offset += 1) {
      const row: MobileDiffLine =
        segment.kind === 'delete'
          ? {
              kind: 'delete',
              text: oldLines[segment.oldStart + offset] ?? '',
              oldLineNumber: segment.oldStart + offset + 1
            }
          : {
              kind: 'add',
              text: newLines[segment.newStart + offset] ?? '',
              newLineNumber: segment.newStart + offset + 1
            }
      if (!push(row, true)) {
        if (segment.kind === 'delete') {
          hiddenDeleted += segment.length - offset
        } else {
          hiddenAdded += segment.length - offset
        }
        return
      }
      const lacksNewline =
        segment.kind === 'delete'
          ? ends.oldUnterminated && row.oldLineNumber === oldLines.length
          : ends.newUnterminated && row.newLineNumber === newLines.length
      if (lacksNewline) {
        // Not through `push`: the cap does not count it, and its row was just drawn.
        lines.push(noNewlineDiffRow())
      }
    }
  })

  // Truncated means a changed row was left out, and only that: a refused unchanged row is always
  // followed by a refused change (see `push`), so none is left out without a word.
  if (hiddenAdded + hiddenDeleted === 0) {
    return { lines, truncated: false }
  }
  return { lines: [...lines, truncatedDiffRow(hiddenAdded, hiddenDeleted)], truncated: true }
}
