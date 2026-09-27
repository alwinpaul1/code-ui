import { describe, expect, it } from 'vitest'
import { CODE_VIEW_FOLD_HIT_SLOP, codeViewMetrics, type CodeViewMetrics } from './mobile-code-view-layout'

/**
 * A model of how React Native 0.86 on Android picks the view a touch lands
 * on, over the code viewer's rows as MobileCodeViewLine lays them out:
 *  - TouchTargetHelper.kt findTouchTargetView: children are tried from the
 *    LAST to the first, and a child outside its parent's bounds is still
 *    tried when the parent's overflow is visible, within its overflowInset;
 *  - YogaLayoutableShadowNode.cpp getContentBounds: a child's hitSlop grows
 *    its parent's overflowInset (outsetBy(frame, hitSlop)), so the reach of
 *    a toggle's hitSlop is not clipped at its row;
 *  - isTouchPointInView: a view with a hitSlop takes the slopped rectangle.
 * FlatList cells are siblings in line order, so a later line is tried first.
 */
type Slop = { top: number; bottom: number; left: number; right: number }
type Box = { name: string; x: number; y: number; w: number; h: number; slop?: Slop }
type Row = { line: number; y: number; h: number; children: Box[] }

function inBox(px: number, py: number, box: Box): boolean {
  const s = box.slop ?? { top: 0, bottom: 0, left: 0, right: 0 }
  return px >= box.x - s.left && px < box.x + box.w + s.right && py >= box.y - s.top && py < box.y + box.h + s.bottom
}

function rows(metrics: CodeViewMetrics, headers: Set<number>, slop: Slop, count: number): Row[] {
  return Array.from({ length: count }, (_, index) => {
    const line = index + 1
    const y = index * metrics.rowHeight
    const h = metrics.rowHeight
    return {
      line,
      y,
      h,
      children: [
        { name: `gutter ${line}`, x: 0, y, w: metrics.numberWidth, h },
        headers.has(line)
          ? { name: `toggle ${line}`, x: metrics.numberWidth, y, w: metrics.foldWidth, h, slop }
          : { name: `fold column ${line}`, x: metrics.numberWidth, y, w: metrics.foldWidth, h },
        { name: `code ${line}`, x: metrics.gutterWidth, y, w: 300, h }
      ]
    }
  })
}

function hit(all: Row[], px: number, py: number): string {
  for (let r = all.length - 1; r >= 0; r -= 1) {
    const row = all[r]!
    const insideRow = py >= row.y && py < row.y + row.h
    // Outside the row, only a child whose hitSlop reaches the point can take it.
    for (let c = row.children.length - 1; c >= 0; c -= 1) {
      const child = row.children[c]!
      if (inBox(px, py, child) && (insideRow || child.slop)) {
        return child.name
      }
    }
    if (insideRow) {
      return `row ${row.line}`
    }
  }
  return 'nothing'
}

const cases = [1, 1.3, 2].map((fontScale) => {
  const metrics = codeViewMetrics({ lineCount: 40, maxColumns: 60, fontScale, foldable: true })
  return {
    fontScale,
    metrics,
    slop: CODE_VIEW_FOLD_HIT_SLOP,
    glyphX: metrics.numberWidth + metrics.foldWidth / 2,
    onesDigitX: metrics.gutterDigits * metrics.cellWidth - metrics.cellWidth / 2,
    firstCodeX: metrics.gutterWidth + metrics.cellWidth / 2,
    middleY: (line: number) => (line - 1) * metrics.rowHeight + metrics.rowHeight / 2
  }
})

// A 48-point reach took touches from the rows around it: FlatList cells
// are siblings tried from the last, and a toggle's hitSlop grows its row's
// overflow, so the next line's toggle was tried before this line's number,
// code or toggle (review, 2026-09-27, on 646eebfb). A row cannot hold a
// target taller than itself without stealing from its neighbour.
describe.each(cases)('where a touch lands around a fold toggle (font scale $fontScale)', ({ metrics, slop, glyphX, onesDigitX, firstCodeX, middleY }) => {
  // class Foo {        <- line 1, a header
  //   constructor() {  <- line 2, a header
  it("folds line 1 at a tap on the middle of line 1's ▾, when line 2 is a header too", () => {
    expect(hit(rows(metrics, new Set([1, 2]), slop, 3), glyphX, middleY(1))).toBe('toggle 1')
  })

  // }                  <- line 1, the end of the last block
  // function next() {  <- line 2, a header
  it("selects line 1 at a long-press on line 1's number, when line 2 is a header", () => {
    expect(hit(rows(metrics, new Set([2]), slop, 3), onesDigitX, middleY(1))).toBe('gutter 1')
  })

  it("selects a header at a long-press on its own number", () => {
    expect(hit(rows(metrics, new Set([2]), slop, 3), onesDigitX, middleY(2))).toBe('gutter 2')
  })

  it('selects the line above a header at a long-press on its first character', () => {
    expect(hit(rows(metrics, new Set([2]), slop, 3), firstCodeX, middleY(1))).toBe('code 1')
  })
})
