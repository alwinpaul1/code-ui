import { describe, expect, it } from 'vitest'
import type { MobileSyntaxSegment } from '../session/mobile-file-syntax'
import { colorBracketPairs } from './mobile-syntax-brackets'

function kindsOfBrackets(lines: MobileSyntaxSegment[][]): string[] {
  return lines.flatMap((line) =>
    line.filter((segment) => /^[()[\]{}]$/.test(segment.text)).map((s) => `${s.text}${s.kind}`)
  )
}

describe('colouring brackets by how deeply they nest, as the desktop does', () => {
  it('gives each nesting level its own colour and a pair the same colour', () => {
    const lines = colorBracketPairs([[{ text: 'f(a[0], {b: (c)})', kind: 'plain' }]])
    expect(kindsOfBrackets(lines)).toEqual([
      '(bracket1',
      '[bracket2',
      ']bracket2',
      '{bracket2',
      '(bracket3',
      ')bracket3',
      '}bracket2',
      ')bracket1'
    ])
    expect(lines[0]!.map((segment) => segment.text).join('')).toBe('f(a[0], {b: (c)})')
  })

  it('cycles back to the first colour below the third level', () => {
    const lines = colorBracketPairs([[{ text: '(((()))))', kind: 'plain' }]])
    expect(kindsOfBrackets(lines).slice(0, 4)).toEqual([
      '(bracket1',
      '(bracket2',
      '(bracket3',
      '(bracket1'
    ])
  })

  it('carries the depth from one line to the next', () => {
    const lines = colorBracketPairs([
      [{ text: 'call(', kind: 'plain' }],
      [{ text: '    [x],', kind: 'plain' }],
      [{ text: ')', kind: 'plain' }]
    ])
    expect(kindsOfBrackets(lines)).toEqual(['(bracket1', '[bracket2', ']bracket2', ')bracket1'])
  })

  it('leaves brackets inside strings and comments alone, and colours JSON punctuation brackets', () => {
    const lines = colorBracketPairs([
      [
        { text: '{', kind: 'punctuation' },
        { text: '"a(b"', kind: 'string' },
        { text: '# ) not code', kind: 'comment' },
        { text: '}', kind: 'punctuation' }
      ]
    ])
    expect(lines[0]).toEqual([
      { text: '{', kind: 'bracket1' },
      { text: '"a(b"', kind: 'string' },
      { text: '# ) not code', kind: 'comment' },
      { text: '}', kind: 'bracket1' }
    ])
  })

  it('does not go below zero on a stray closing bracket', () => {
    const lines = colorBracketPairs([[{ text: ')(x)', kind: 'plain' }]])
    expect(kindsOfBrackets(lines)).toEqual([')bracket1', '(bracket1', ')bracket1'])
  })

  it('handles no lines and empty lines', () => {
    expect(colorBracketPairs([])).toEqual([])
    expect(colorBracketPairs([[]])).toEqual([[]])
  })
})
