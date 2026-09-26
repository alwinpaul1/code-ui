import { describe, expect, it } from 'vitest'
import {
  CODE_VIEW_MAX_INDENT_GUIDES,
  clipSegmentsToColumns,
  detectIndentStep,
  displayColumns,
  expandTabsInSegments,
  indentGuideCounts,
  leadingIndentColumns
} from './mobile-code-indent'

function guides(source: string, offSide: boolean, tabWidth = 4): number[] {
  const lines = source.split('\n')
  return indentGuideCounts(lines, {
    tabWidth,
    indentStep: detectIndentStep(lines, tabWidth),
    offSide
  })
}

describe('how far a line is indented', () => {
  it('counts spaces as columns and tabs up to the next tab stop', () => {
    expect(leadingIndentColumns('x', 4)).toBe(0)
    expect(leadingIndentColumns('    x', 4)).toBe(4)
    expect(leadingIndentColumns('\tx', 4)).toBe(4)
    expect(leadingIndentColumns('  \tx', 4)).toBe(4)
    expect(leadingIndentColumns('\t\tx', 4)).toBe(8)
    expect(leadingIndentColumns('\tx', 8)).toBe(8)
  })

  it('treats an empty or whitespace-only line as blank, not as indented', () => {
    expect(leadingIndentColumns('', 4)).toBeNull()
    expect(leadingIndentColumns('      ', 4)).toBeNull()
    expect(leadingIndentColumns('\t', 4)).toBeNull()
  })
})

describe('guessing the indent step from the file itself', () => {
  it('reads 4 from a Python file and 2 from a two-space TypeScript file', () => {
    expect(detectIndentStep(['def f():', '    x = 1', '    if x:', '        y()'], 4)).toBe(4)
    expect(detectIndentStep(['function f() {', '  if (x) {', '    y()', '  }', '}'], 4)).toBe(2)
  })

  it('uses the tab width for a tab-indented file', () => {
    expect(detectIndentStep(['func f() {', '\tif x {', '\t\ty()', '\t}', '}'], 4)).toBe(4)
    expect(detectIndentStep(['func f() {', '\tif x {', '\t\ty()', '\t}', '}'], 8)).toBe(8)
  })

  it('falls back to the tab width when nothing is indented, including an empty file', () => {
    expect(detectIndentStep([], 4)).toBe(4)
    expect(detectIndentStep([''], 4)).toBe(4)
    expect(detectIndentStep(['a', 'b'], 4)).toBe(4)
  })

  it('ignores a one-off hanging indent that lines an argument up under a bracket', () => {
    const lines = [
      'def cell(em):',
      '    return dict(total=1,',
      '                snn=2)',
      '    x = 1',
      '    if x:',
      '        y()'
    ]
    expect(detectIndentStep(lines, 4)).toBe(4)
  })
})

describe('indent guides, one per indent level, as the desktop draws them', () => {
  it('draws guides through a Python function body and none on the blank lines after it', () => {
    // From lever_energy.py (2026-09-26 desktop screenshot): the guide at
    // column 0 runs down `def cell`'s body and stops before the next
    // top-level statement, blank lines included. Python is off-side.
    const source = [
      'def cell(em, ds, K):',
      '    sets = paper_rate_sets(ds)',
      '    for r in sets[K]:',
      '        e = em.estimate(r)',
      '',
      '    return e',
      '',
      '',
      "for ds in ('gen1', 'gen4'):"
    ].join('\n')
    expect(guides(source, true)).toEqual([0, 1, 1, 2, 1, 1, 0, 0, 0])
  })

  it('keeps a brace block’s guide through a blank line before its closing brace', () => {
    const source = ['function f() {', '  if (x) {', '    y()', '', '  }', '}'].join('\n')
    expect(guides(source, false)).toEqual([0, 1, 2, 2, 1, 0])
  })

  it('opens the block on a blank line right after its header', () => {
    expect(guides('def f():\n\n    x = 1', true)).toEqual([0, 1, 1])
  })

  it('puts one guide per level of a hanging continuation indent', () => {
    // lever_energy.py line 30: `bridge=…` under `dict(` sits 16 columns in.
    const source = ['def f():', '    return dict(a=1,', '                b=2)'].join('\n')
    expect(guides(source, true)).toEqual([0, 1, 4])
  })

  it('expands tabs to the tab width before counting levels', () => {
    expect(guides('if x {\n\ty()\n\t\tz()\n}', false)).toEqual([0, 1, 2, 0])
  })

  it('handles the degenerate files: none, one blank, one indented line', () => {
    expect(indentGuideCounts([], { tabWidth: 4, indentStep: 4, offSide: false })).toEqual([])
    expect(guides('', false)).toEqual([0])
    expect(guides('   ', true)).toEqual([0])
    expect(guides('    x', false)).toEqual([1])
    expect(guides('\n\n', false)).toEqual([0, 0, 0])
  })

  it('caps the guides on an absurdly deep line', () => {
    const deep = `${' '.repeat(4_000)}x`
    expect(guides(deep, false)[0]).toBe(CODE_VIEW_MAX_INDENT_GUIDES)
  })
})

describe('laying code on a monospace grid', () => {
  it('expands tabs to their stops, carrying the column across coloured spans', () => {
    expect(
      expandTabsInSegments(
        [
          { text: '\tx', kind: 'plain' },
          { text: '\t// c', kind: 'comment' }
        ],
        4
      )
    ).toEqual([
      { text: '    x', kind: 'plain' },
      { text: '   // c', kind: 'comment' }
    ])
    expect(expandTabsInSegments([], 4)).toEqual([])
  })

  it('counts wide characters as two columns', () => {
    expect(displayColumns('ab', 4)).toBe(2)
    expect(displayColumns('a\tb', 4)).toBe(5)
    expect(displayColumns('中文', 4)).toBe(4)
    expect(displayColumns('😀', 4)).toBe(2)
    expect(displayColumns('', 4)).toBe(0)
  })

  it('cuts a line past the no-wrap limit and marks the cut', () => {
    const clipped = clipSegmentsToColumns(
      [
        { text: 'abc', kind: 'keyword' },
        { text: 'defgh', kind: 'string' }
      ],
      5
    )
    expect(clipped.slice(0, 2)).toEqual([
      { text: 'abc', kind: 'keyword' },
      { text: 'de', kind: 'string' }
    ])
    expect(clipped[2]?.kind).toBe('comment')
    expect(clipped[2]?.text).toContain('3 more')
  })

  it('leaves a line that fits exactly untouched', () => {
    const segments = [{ text: 'abcde', kind: 'plain' as const }]
    expect(clipSegmentsToColumns(segments, 5)).toBe(segments)
    expect(clipSegmentsToColumns([], 5)).toEqual([])
  })
})
