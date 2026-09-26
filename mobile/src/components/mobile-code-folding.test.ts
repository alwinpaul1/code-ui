import { describe, expect, it } from 'vitest'
import {
  computeFoldRegions,
  listIndexOfLine,
  rangeCoveringFolds,
  visibleLineIndices,
  type CodeFoldRegion
} from './mobile-code-folding'
import { buildMobileCodeDocument } from './mobile-code-document'

// Regions are 0-based and inclusive: `start` is the line that stays visible
// (the block's header), `end` the last line the fold hides.
const TAB = 4
const indentFolds = (lines: string[], offSide = false) => computeFoldRegions(lines, { tabWidth: TAB, offSide })
const spans = (regions: readonly CodeFoldRegion[]) => regions.map(({ start, end }) => [start, end])

const PYTHON = [
  'def cell(em):', // 0
  '    for r in em:', // 1
  '        yield r', // 2
  '', // 3
  '    return None', // 4
  '', // 5
  'def other():', // 6
  '    pass' // 7
]

const TYPESCRIPT = [
  'class Store {', // 0
  '  get(key: string) {', // 1
  '    return this.map.get(key)', // 2
  '  }', // 3
  '', // 4
  '  set(key: string) {', // 5
  '    this.map.set(key)', // 6
  '  }', // 7
  '}' // 8
]

describe('finding the blocks a file folds into, as the desktop editor does', () => {
  it('folds a Python function over its body, nested blocks too, and leaves the blank line before the next def out', () => {
    // Monaco's off-side rule: a blank line between blocks belongs to the
    // block above only while the block goes on below it.
    expect(spans(indentFolds(PYTHON, true))).toEqual([
      [0, 4],
      [1, 2],
      [6, 7]
    ])
  })

  it('folds a brace block over its body and keeps the closing brace on show, blank lines inside included', () => {
    expect(spans(indentFolds(TYPESCRIPT))).toEqual([
      [0, 7],
      [1, 2],
      [5, 6]
    ])
  })

  it('folds the last block of a file down to its last line', () => {
    expect(spans(indentFolds(['settings:', '  theme: dark', '  wrap: false'], true))).toEqual([[0, 2]])
    // A trailing newline is one more (blank) line: a brace-style file keeps it
    // in the block, an off-side one leaves it out.
    expect(spans(indentFolds(['if (a) {', '  b()', ''], false))).toEqual([[0, 2]])
    expect(spans(indentFolds(['if a:', '    b()', ''], true))).toEqual([[0, 1]])
  })

  it('folds a block cut short by a truncated preview only as far as the text that arrived', () => {
    // The host sent the first 3 lines of a longer function.
    expect(spans(indentFolds(['def rotate(path):', '    for i in range(5):', '        os.rename('], true))).toEqual([
      [0, 2],
      [1, 2]
    ])
  })

  it('folds a block with a one-line body', () => {
    expect(spans(indentFolds(['if a:', '    b()'], true))).toEqual([[0, 1]])
  })

  it('finds nothing to fold in a one-line file, an empty one, or one of blank lines', () => {
    expect(indentFolds(['print("hi")'])).toEqual([])
    expect(indentFolds([''])).toEqual([])
    expect(indentFolds([])).toEqual([])
    expect(indentFolds(['', '   ', '\t', ''])).toEqual([])
    expect(indentFolds(['    indented alone'])).toEqual([])
  })

  it('reads a tab as reaching the next tab stop', () => {
    const go = ['func main() {', '\tif x {', '\t\ty()', '\t}', '}']
    expect(spans(indentFolds(go))).toEqual([
      [0, 3],
      [1, 2]
    ])
  })

  it('puts lines indented by a tab and by the same width of spaces in one block', () => {
    // '\t    ' reaches column 8, as eight spaces do; ' \t' reaches 4.
    const mixed = ['def f():', ' \tif a:', '\t    x = 1', '        y = 2', '    return x']
    expect(spans(indentFolds(mixed, true))).toEqual([
      [0, 4],
      [1, 3]
    ])
  })

  it('keeps the outermost blocks when a file has more than the limit, as the desktop does', () => {
    const lines = Array.from({ length: 3 }, (_, i) => [`block${i}:`, '    inner:', '        x']).flat()
    const all = computeFoldRegions(lines, { tabWidth: TAB, offSide: true })
    expect(all).toHaveLength(6)
    const limited = computeFoldRegions(lines, { tabWidth: TAB, offSide: true, limit: 4 })
    // All three top-level blocks, then the first nested one that still fits.
    expect(spans(limited)).toEqual([
      [0, 2],
      [1, 2],
      [3, 5],
      [6, 8]
    ])
  })

  it('gives the document its blocks: none for a minified line, some for pretty-printed JSON', () => {
    expect(buildMobileCodeDocument(`var a=${'[1,2],'.repeat(5_000)}0`, 'javascript').folds).toEqual([])
    const json = buildMobileCodeDocument('{"a":{"b":[1,2]}}', 'json')
    expect(json.reformatted).toBe(true)
    expect(spans(json.folds)).toEqual([
      [0, 6],
      [1, 5],
      [2, 4]
    ])
    expect(spans(buildMobileCodeDocument(PYTHON.join('\n'), 'python').folds)).toEqual([
      [0, 4],
      [1, 2],
      [6, 7]
    ])
  })
})

describe('which lines the windowed list draws when blocks are folded', () => {
  const regions = indentFolds(PYTHON, true)

  it('draws every line when nothing is folded', () => {
    expect(visibleLineIndices(PYTHON.length, regions, new Set())).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('hides the body of a folded block and keeps its header', () => {
    expect(visibleLineIndices(PYTHON.length, regions, new Set([1]))).toEqual([0, 1, 3, 4, 5, 6, 7])
  })

  it('hides a folded block inside a folded block once, and brings the inner fold back as it was', () => {
    expect(visibleLineIndices(PYTHON.length, regions, new Set([0, 1]))).toEqual([0, 5, 6, 7])
    expect(visibleLineIndices(PYTHON.length, regions, new Set([1]))).toEqual([0, 1, 3, 4, 5, 6, 7])
  })

  it('hides a block folded at the end of the file down to the last line', () => {
    expect(visibleLineIndices(PYTHON.length, regions, new Set([6]))).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('draws the one line of an empty file, and ignores a fold with no block', () => {
    expect(visibleLineIndices(1, [], new Set())).toEqual([0])
    expect(visibleLineIndices(3, [], new Set([0]))).toEqual([0, 1, 2])
  })

  it('finds the row a line is drawn on, or the folded header hiding it', () => {
    const visible = visibleLineIndices(PYTHON.length, regions, new Set([1]))
    expect(listIndexOfLine(visible, 0)).toBe(0)
    expect(listIndexOfLine(visible, 1)).toBe(1)
    expect(listIndexOfLine(visible, 2)).toBe(1) // hidden: its header's row
    expect(listIndexOfLine(visible, 3)).toBe(2)
    expect(listIndexOfLine(visible, 7)).toBe(6)
    expect(listIndexOfLine(visible, 99)).toBe(6)
    expect(listIndexOfLine(visible, -3)).toBe(0)
    expect(listIndexOfLine([0], 0)).toBe(0)
  })
})

describe('a line selection over folded blocks', () => {
  const regions = indentFolds(PYTHON, true)

  it('takes in the hidden lines of a folded block whose header it holds', () => {
    // Line numbers are 1-based here, as the gutter shows them.
    expect(rangeCoveringFolds({ start: 2, end: 2 }, regions, new Set([1]))).toEqual({ start: 2, end: 3 })
    expect(rangeCoveringFolds({ start: 1, end: 2 }, regions, new Set([1]))).toEqual({ start: 1, end: 3 })
    expect(rangeCoveringFolds({ start: 1, end: 1 }, regions, new Set([0, 1]))).toEqual({ start: 1, end: 5 })
  })

  it('leaves a selection alone when the block is open, or already covered', () => {
    expect(rangeCoveringFolds({ start: 2, end: 2 }, regions, new Set())).toEqual({ start: 2, end: 2 })
    expect(rangeCoveringFolds({ start: 1, end: 8 }, regions, new Set([1, 6]))).toEqual({ start: 1, end: 8 })
    expect(rangeCoveringFolds({ start: 7, end: 7 }, regions, new Set([6]))).toEqual({ start: 7, end: 8 })
  })
})
