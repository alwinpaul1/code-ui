import { describe, expect, it } from 'vitest'
import { parseMarkdownBlocks } from './markdown-blocks'
import { parseMobileMarkdown } from '../mobile-markdown-parser'

// Review, 2026-09-30: a PR comment's list item hard-wrapped with no indent on the next line drew as
// the list and then a paragraph of the wrapped words, while the chat drew and copied the same text
// as one item, '• a lazy'. CommonMark reads such a line (a lazy continuation line) as more of the
// item's words. The indented wrap is pinned in markdown-wrapped-items.test.ts.

const bullet = (depth: number) => ({ depth, ordered: false })

describe('a wrapped line at the margin under a PR comment’s list item', () => {
  it('keeps it in the item, as the chat does', () => {
    expect(parseMarkdownBlocks('- a\nlazy')).toEqual([
      { kind: 'list', ordered: false, items: ['a lazy'] }
    ])
    expect(parseMobileMarkdown('- a\nlazy')).toMatchObject([
      { type: 'list', items: [{ text: 'a lazy' }] }
    ])
  })

  it.each([
    [
      'a numbered item before the next',
      '1. first line\nsecond line\n2. b',
      [{ kind: 'list', ordered: true, items: ['first line second line', 'b'] }]
    ],
    [
      'after an indented wrapped line',
      '- a\n  lazy\nb',
      [{ kind: 'list', ordered: false, items: ['a lazy b'] }]
    ],
    [
      'a nested item',
      '- a\n  - b\nc',
      [{ kind: 'list', ordered: false, items: ['a', 'b c'], shapes: [bullet(0), bullet(1)] }]
    ],
    [
      'a task',
      '- [ ] a\nlazy',
      [
        {
          kind: 'list',
          ordered: false,
          items: ['a lazy'],
          shapes: [{ ...bullet(0), checked: false }]
        }
      ]
    ],
    [
      'the last line, with a blank line after',
      '- a\nlazy\n',
      [{ kind: 'list', ordered: false, items: ['a lazy'] }]
    ]
  ])('keeps it in %s', (_name, markdown, blocks) => {
    expect(parseMarkdownBlocks(markdown)).toEqual(blocks)
  })

  it.each([
    ['a blank line', '- a\n\nb', { kind: 'paragraph', text: 'b' }],
    ['a heading', '- a\n# h', { kind: 'heading', level: 1, text: 'h' }],
    ['a quote', '- a\n> q', { kind: 'quote', text: 'q' }],
    ['a fence', '- a\n```\nx\n```', { kind: 'code', text: 'x', lang: '' }],
    ['a rule', '- a\n***', { kind: 'hr' }],
    ['a list of the other kind', '- a\n1. b', { kind: 'list', ordered: true, items: ['b'] }],
    ['an underline', '- a\n===', { kind: 'paragraph', text: '===' }],
    ['a tag', '- a\n<b>x</b>', { kind: 'paragraph', text: '<b>x</b>' }],
    [
      'a table',
      '- a\n| x | y |\n| - | - |',
      { kind: 'table', headers: ['x', 'y'], rows: [], align: ['left', 'left'] }
    ]
  ])('ends the item at %s', (_name, markdown, after) => {
    expect(parseMarkdownBlocks(markdown)).toEqual([
      { kind: 'list', ordered: false, items: ['a'] },
      after
    ])
  })

  it('ends the item at an empty marker rather than taking it for words', () => {
    expect(parseMarkdownBlocks('- a\n-')[0]).toEqual({ kind: 'list', ordered: false, items: ['a'] })
  })

  it('ends the item after a fence under it', () => {
    expect(parseMarkdownBlocks('- a\n  ```\n  x\n  ```\nlazy')).toEqual([
      { kind: 'list', ordered: false, items: ['a'] },
      { kind: 'code', text: 'x', lang: '' },
      { kind: 'paragraph', text: 'lazy' }
    ])
  })
})
