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

/** How wide the gutter has to be for the highest line number: its digits
 *  in the code face (JetBrains Mono at 14 px is ~8.4 px a glyph) plus the gap
 *  the gutter keeps before the code (`MobileSyntaxLine`'s paddingRight). */
export function gutterWidthForLines(count: number, charWidth = 9): number {
  return Math.max(2, String(Math.max(count, 1)).length) * charWidth + 10
}

/** A digit's width in the code face at `fontSize`: JetBrains Mono's 0.6 em,
 *  rounded up, and a dp for Android rounding the type up to a whole pixel
 *  (TextAttributes.kt). 9 at 13 sp, the gutter's old fixed price; at the
 *  transcript's 15 sp a bare 9 left "10" a fraction of a pixel too wide for its
 *  box, and it broke over two rows (review, 2026-10-11). */
export function gutterCharWidth(fontSize: number): number {
  return Math.ceil(0.6 * fontSize) + 1
}
