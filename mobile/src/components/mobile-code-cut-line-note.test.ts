import { describe, expect, it } from 'vitest'
import { buildMobileCodeDocument } from './mobile-code-document'
import { clipSegmentsToColumns, displayColumns } from './mobile-code-indent'
import { CODE_VIEW_MAX_NO_WRAP_COLUMNS, CODE_VIEW_PADDING_START, codeViewMetrics } from './mobile-code-view-layout'

/** Grid columns the code area of one unwrapped row really has: the list's
 *  width, less its left padding and the gutter (MobileCodeViewLine). */
function codeAreaColumns(doc: { lines: string[]; maxColumns: number }): number {
  const metrics = codeViewMetrics({ lineCount: doc.lines.length, maxColumns: doc.maxColumns, fontScale: 1 })
  return (metrics.contentWidth - CODE_VIEW_PADDING_START - metrics.gutterWidth) / metrics.cellWidth
}

/** The widest line as the unwrapped view draws it: cut, with its note. */
function drawnColumns(doc: { lines: string[] }): number {
  return Math.max(
    ...doc.lines.map((line) =>
      clipSegmentsToColumns([{ text: line, kind: 'string' }], CODE_VIEW_MAX_NO_WRAP_COLUMNS).reduce(
        (sum, segment) => sum + displayColumns(segment.text, 4),
        0
      )
    )
  )
}

describe('a line cut at the no-wrap limit', () => {
  it('keeps the whole "… N more characters" note inside the row, so the count can be read', () => {
    // A file with one line past 2,000 columns, read with wrapping turned off.
    const long = `const bundle = "${'a'.repeat(CODE_VIEW_MAX_NO_WRAP_COLUMNS + 4_000)}"`
    const doc = buildMobileCodeDocument(`${long}\nexport default bundle\n`, 'javascript')
    const clipped = clipSegmentsToColumns([{ text: long, kind: 'string' }], CODE_VIEW_MAX_NO_WRAP_COLUMNS)
    expect(clipped.at(-1)).toEqual({ text: '  … 4017 more characters', kind: 'comment' })
    // numberOfLines={1} + ellipsizeMode="clip": whatever does not fit is cut.
    expect(drawnColumns(doc)).toBeLessThanOrEqual(codeAreaColumns(doc))
  })

  it('has room for the note of a line one column over the limit, and of a line of ten million', () => {
    for (const over of [1, 10_000_000]) {
      const doc = buildMobileCodeDocument('x'.repeat(CODE_VIEW_MAX_NO_WRAP_COLUMNS + over), 'plaintext')
      expect(drawnColumns(doc)).toBeLessThanOrEqual(codeAreaColumns(doc))
    }
  })

  it('says "1 more character" for one', () => {
    const clipped = clipSegmentsToColumns([{ text: 'x'.repeat(CODE_VIEW_MAX_NO_WRAP_COLUMNS + 1), kind: 'plain' }], CODE_VIEW_MAX_NO_WRAP_COLUMNS)
    expect(clipped.at(-1)!.text).toBe('  … 1 more character')
  })

  it('does not widen a file whose longest line fits, not even one at the limit exactly', () => {
    for (const width of [0, 1, CODE_VIEW_MAX_NO_WRAP_COLUMNS]) {
      const doc = buildMobileCodeDocument('x'.repeat(width), 'plaintext')
      // Two spare columns and the end padding (24 points, about three), no more.
      expect(codeAreaColumns(doc) - width).toBeLessThan(6)
      expect(drawnColumns(doc)).toBe(width)
    }
  })
})
