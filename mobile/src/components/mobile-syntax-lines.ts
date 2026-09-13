import type { MobileSyntaxSegment } from '../session/mobile-file-syntax'

/**
 * Cut a highlighted file into lines, keeping each line's colouring.
 *
 * Why: a numbered gutter needs one row per source line, and the highlighter
 * hands back segments that run across newlines (2026-09-13). A segment is
 * split at every newline it contains and its kind carried into each piece.
 * Empty lines survive as empty arrays so the numbering never drifts.
 */
export function splitSyntaxIntoLines(
  segments: readonly MobileSyntaxSegment[]
): MobileSyntaxSegment[][] {
  const lines: MobileSyntaxSegment[][] = [[]]
  for (const segment of segments) {
    const pieces = segment.text.split('\n')
    for (const [index, piece] of pieces.entries()) {
      if (index > 0) {
        lines.push([])
      }
      if (piece.length > 0) {
        lines[lines.length - 1]?.push({ ...segment, text: piece })
      }
    }
  }
  return lines
}

/** How wide the gutter has to be for the highest line number. */
export function gutterWidthForLines(count: number, charWidth = 8): number {
  return Math.max(2, String(Math.max(count, 1)).length) * charWidth + 10
}
