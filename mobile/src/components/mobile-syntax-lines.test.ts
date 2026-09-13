import { describe, expect, it } from 'vitest'
import { gutterWidthForLines, splitSyntaxIntoLines } from './mobile-syntax-lines'

// 2026-09-13: the file reader shows numbered lines, and the highlighter hands
// back segments that run across newlines, so a numbered gutter needs them cut.
describe('splitSyntaxIntoLines', () => {
  it('cuts a segment that spans newlines and keeps each piece coloured', () => {
    expect(
      splitSyntaxIntoLines([
        { text: 'const a = 1\nconst b', kind: 'keyword' },
        { text: ' = 2', kind: 'plain' }
      ])
    ).toEqual([
      [{ text: 'const a = 1', kind: 'keyword' }],
      [
        { text: 'const b', kind: 'keyword' },
        { text: ' = 2', kind: 'plain' }
      ]
    ])
  })

  it('keeps blank lines, so the numbering never drifts', () => {
    const lines = splitSyntaxIntoLines([{ text: 'a\n\nb', kind: 'plain' }])
    expect(lines).toHaveLength(3)
    expect(lines[1]).toEqual([])
  })

  it('widens the gutter with the highest line number', () => {
    expect(gutterWidthForLines(9)).toBeLessThan(gutterWidthForLines(1200))
  })
})
