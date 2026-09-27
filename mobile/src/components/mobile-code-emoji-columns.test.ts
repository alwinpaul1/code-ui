import { describe, expect, it } from 'vitest'
import { buildMobileCodeDocument } from './mobile-code-document'
import { clipSegmentsToColumns, codePointColumns, displayColumns } from './mobile-code-indent'
import { CODE_VIEW_PADDING_START, codeViewMetrics } from './mobile-code-view-layout'

/** Grid columns the code area of one unwrapped row really has: the list's
 *  width, less its left padding and the gutter (MobileCodeViewLine). */
function codeAreaColumns(doc: { lines: string[]; maxColumns: number }): number {
  const metrics = codeViewMetrics({ lineCount: doc.lines.length, maxColumns: doc.maxColumns, fontScale: 1 })
  return (metrics.contentWidth - CODE_VIEW_PADDING_START - metrics.gutterWidth) / metrics.cellWidth
}

const columnsOf = (char: string) => codePointColumns(char.codePointAt(0)!)

describe('emoji that the phone draws two cells wide', () => {
  it('counts ✅ as two columns, as it counts 😀', () => {
    // Both are East Asian Width "W" and draw as colour emoji; the helper's own
    // doc says "two for … emoji".
    expect(columnsOf('😀')).toBe(2)
    expect(columnsOf('✅')).toBe(2)
  })

  it('counts every emoji below U+1F300 that draws as an emoji by default as two', () => {
    for (const emoji of ['✅', '❌', '⭐', '⚡', '⏳', '⌚', '☕', '♿', '⛔', '✨', '❓', '➕', '⬛', '⭕']) {
      expect(columnsOf(emoji), emoji).toBe(2)
    }
  })

  it('keeps one column for text that only turns emoji with a selector, and for plain letters and symbols', () => {
    // U+2764 and U+263A draw as text unless U+FE0F follows them.
    for (const char of ['A', '~', '❤', '☺', '→', '…', 'é']) {
      expect(columnsOf(char), char).toBe(1)
    }
    expect(columnsOf('中')).toBe(2)
  })

  it('leaves room for the whole widest line when it holds a row of check marks', () => {
    const table = '| lint ✅ | types ✅ | tests ✅ | build ✅ | docs ✅ | e2e ✅ | release ✅ | deploy ✅ |'
    const doc = buildMobileCodeDocument(`# Status\n\n${table}\n`, 'markdown')
    // Each ✅ draws as a colour emoji about two monospace cells wide.
    const needed = [...table].reduce((sum, char) => sum + (char === '✅' ? 2 : 1), 0)
    expect(doc.maxColumns).toBe(needed)
    expect(codeAreaColumns(doc)).toBeGreaterThanOrEqual(needed)
  })

  it('cuts a line of emoji on the grid, never through the middle of one', () => {
    expect(displayColumns('', 4)).toBe(0)
    expect(displayColumns('✅', 4)).toBe(2)
    const cut = clipSegmentsToColumns([{ text: '✅✅✅', kind: 'plain' }], 3)
    expect(cut[0]).toEqual({ text: '✅', kind: 'plain' })
    expect(cut.at(-1)!.text).toBe('  … 2 more characters')
  })

  it('measures a box-drawing tree without testing each character for emoji', () => {
    // A 1.1 MB `├──` tree took 284 ms on Hermes against 37 ms for ASCII: a
    // regex ran on every code point from U+231A up (review, 2026-09-27).
    const tree = '├── src\n│   └── index.ts\n'.repeat(2_000)
    displayColumns(tree, 4) // the first call may build its tables
    const test = RegExp.prototype.test
    let tests = 0
    RegExp.prototype.test = function (this: RegExp, value: string) {
      tests += 1
      return test.call(this, value)
    }
    try {
      expect(displayColumns(tree, 4)).toBe([...tree].length)
    } finally {
      RegExp.prototype.test = test
    }
    expect(tests).toBeLessThan(10)
    // And the answers are the same: box drawing one column, ✅ two.
    expect(columnsOf('├')).toBe(1)
    expect(columnsOf('│')).toBe(1)
    expect(columnsOf('⏳')).toBe(2)
    expect(columnsOf('🀄')).toBe(2)
    expect(columnsOf('🂡')).toBe(1)
  })
})
