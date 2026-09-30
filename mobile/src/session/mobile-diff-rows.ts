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
 * on line 2,900 used to draw 2,500 unchanged rows and nothing else). Only if the folded diff is
 * still over the cap is it cut, and the last row then says which changed rows it left out.
 *
 * The cap counts the file's rows and the fold's "N unchanged lines" rows. git's "\ No newline at
 * end of file" is not counted: it rides with the changed row above it, drawn whenever that row is
 * and never on its own, so a diff whose rows fit is drawn whole with its notes (at most two rows
 * past the cap), and a note can neither push out the last changed row nor be the row the cap
 * refuses. Counted, it cut a replaced block of exactly 2,500 rows, or said it was truncated with
 * nothing left out (review, 2026-09-30).
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
  // The rows the cap counts: every row but the no-newline notes.
  let counted = 0
  let dropped = false
  let hiddenAdded = 0
  let hiddenDeleted = 0
  const push = (line: MobileDiffLine): boolean => {
    if (counted >= MAX_MOBILE_DIFF_LINES) {
      dropped = true
      return false
    }
    lines.push(line)
    counted += 1
    return true
  }
  const pushContext = (
    segment: Extract<DiffSegment, { kind: 'context' }>,
    from: number,
    to: number
  ): void => {
    for (let offset = from; offset < to; offset += 1) {
      const oldIndex = segment.oldStart + offset
      if (
        !push({
          kind: 'context',
          text: oldLines[oldIndex] ?? '',
          oldLineNumber: oldIndex + 1,
          newLineNumber: segment.newStart + offset + 1
        })
      ) {
        return
      }
    }
  }

  segments.forEach((segment, index) => {
    if (segment.kind === 'context') {
      const head = index === 0 ? 0 : CONTEXT_ROWS
      const tail = index === segments.length - 1 ? 0 : CONTEXT_ROWS
      const hidden = segment.length - head - tail
      // Folding one row into a row that says "1 unchanged line" hides nothing.
      if (!fold || hidden < 2) {
        pushContext(segment, 0, segment.length)
        return
      }
      pushContext(segment, 0, head)
      push(collapsedDiffRow(hidden))
      pushContext(segment, segment.length - tail, segment.length)
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
      if (!push(row)) {
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

  if (!dropped) {
    return { lines, truncated: false }
  }
  return { lines: [...lines, truncatedDiffRow(hiddenAdded, hiddenDeleted)], truncated: true }
}
