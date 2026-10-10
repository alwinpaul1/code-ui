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

// Review, 2026-10-01: the lazy line above joined any item, words or none. '- \nlazy' drew one bullet
// reading " lazy", and '- # H\nlazy' and '- ***\nlazy' drew the line inside the heading's or the
// rule's text. A lazy line continues a paragraph, so marked (the desktop's reader) and CommonMark
// both draw it after the list when the item's last line is no words, a heading or a rule, as this
// reader did before the lazy line was read at all. The expected blocks are the ones it drew then.
describe('a line at the margin under a PR comment’s list item that ends in no words', () => {
  const list = (items: string[]) => ({ kind: 'list', ordered: false, items })
  const lazy = { kind: 'paragraph', text: 'lazy' }

  it.each([
    ['an empty item', '- \nlazy', [list(['']), lazy]],
    ['an empty numbered item', '1. \nlazy', [{ kind: 'list', ordered: true, items: [''] }, lazy]],
    [
      'an empty task',
      '- [ ] \nlazy',
      [{ ...list(['']), shapes: [{ ...bullet(0), checked: false }] }, lazy]
    ],
    [
      'an empty nested item',
      '- a\n  - \nlazy',
      [{ ...list(['a', '']), shapes: [bullet(0), bullet(1)] }, lazy]
    ]
  ])('keeps it out of %s', (_name, markdown, blocks) => {
    expect(parseMarkdownBlocks(markdown)).toEqual(blocks)
  })

  it('still keeps it in the words of an item after an empty one', () => {
    expect(parseMarkdownBlocks('- \n- b\nlazy')).toEqual([list(['', 'b lazy'])])
  })

  it.each([
    ['a heading', '- # H\nlazy', '# H'],
    ['a heading with nothing after its mark', '- #\nlazy', '#'],
    ['a heading after a tab', '- #\tH\nlazy', '#\tH'],
    ['a sixth-level heading', '- ###### H\nlazy', '###### H'],
    ['a rule of stars', '- ***\nlazy', '***'],
    ['a rule of spaced stars', '- * * *\nlazy', '* * *'],
    ['a rule of underscores', '- ___\nlazy', '___']
  ])('draws it after the list, not inside %s the item holds', (_name, markdown, item) => {
    expect(parseMarkdownBlocks(markdown)).toEqual([list([item]), lazy])
  })

  it.each([
    ['a heading', '- a\n  # h\nlazy', 'a # h'],
    ['a rule', '- a\n  ***\nlazy', 'a ***'],
    ['a dashed rule', '- a\n  ---\nlazy', 'a ---']
  ])('draws it after the list where the item’s indented last line is %s', (_name, markdown, item) => {
    expect(parseMarkdownBlocks(markdown)).toEqual([list([item]), lazy])
  })

  it('draws it after the list where a nested item is a heading', () => {
    expect(parseMarkdownBlocks('- a\n  - # h\nlazy')).toEqual([
      { ...list(['a', '# h']), shapes: [bullet(0), bullet(1)] },
      lazy
    ])
  })

  it.each([
    ['words', '- a\nlazy', 'a lazy'],
    ['words and a line of them at the margin', '- a\nlazy\nmore', 'a lazy more'],
    ['dashes that are words, not a rule', '- ---x\nlazy', '---x lazy'],
    ['a hash with words straight after it', '- \\# H\nlazy', '\\# H lazy'],
    ['words indented under a heading', '- # H\n  more\nlazy', '# H more lazy']
  ])('still keeps it in an item ending in %s', (_name, markdown, item) => {
    expect(parseMarkdownBlocks(markdown)).toEqual([list([item])])
  })

  it('still keeps it in a task whose words look like a rule or a heading', () => {
    expect(parseMarkdownBlocks('- [ ] ***\nlazy\n- [x] # h\nlazy')).toEqual([
      {
        ...list(['*** lazy', '# h lazy']),
        shapes: [
          { ...bullet(0), checked: false },
          { ...bullet(0), checked: true }
        ]
      }
    ])
  })

  it.each([
    ['a heading and its indented words', '- # H\n  more', [list(['# H more'])]],
    ['an empty item at the end', '- ', [list([''])]],
    ['an empty item before a last newline', '- \n', [list([''])]]
  ])('reads %s as it did', (_name, markdown, blocks) => {
    expect(parseMarkdownBlocks(markdown)).toEqual(blocks)
  })
})

// The quote's lazy lines follow marked, which keeps these in the quote: '> # h\nbody' is a quote of
// a heading and a paragraph there. They are pinned so the list's rule above is not copied here.
describe('a line at the margin under a PR comment’s quote that ends in no words', () => {
  it.each([
    ['a heading', '> # h\nbody', '# h\nbody'],
    ['a rule', '> ---\nbody', '---\nbody'],
    ['a table', '> | a |\n> | - |\nbody', '| a |\n| - |\nbody']
  ])('keeps it in the quote after %s, as marked does', (_name, markdown, text) => {
    expect(parseMarkdownBlocks(markdown)).toEqual([{ kind: 'quote', text }])
  })
})

// Sweep, 2026-09-30: the quote reader had the same defect as the list's. '> first line\nsecond
// line' drew as a quote of the first line and a paragraph of the second; the chat, and CommonMark,
// read one quote.
describe('a wrapped line at the margin under a PR comment’s quote', () => {
  it('keeps it in the quote, as the chat does', () => {
    expect(parseMarkdownBlocks('> first line\nsecond line')).toEqual([
      { kind: 'quote', text: 'first line\nsecond line' }
    ])
    // Inside a quote the chat breaks every newline now (2026-10-10), so it
    // reads the PR comment's two lines too.
    expect(parseMobileMarkdown('> first line\nsecond line')).toMatchObject([
      { type: 'quote', members: [{ type: 'paragraph', text: 'first line\nsecond line' }] }
    ])
  })

  it('keeps every such line, the last one included', () => {
    expect(parseMarkdownBlocks('> a\n> b\nc\nd\n')).toEqual([{ kind: 'quote', text: 'a\nb\nc\nd' }])
  })

  it.each([
    ['a blank line', '> a\n\nb', [{ kind: 'quote', text: 'a' }]],
    ['a blank quote line', '> a\n>\nb', [{ kind: 'quote', text: 'a' }]],
    ['a fence in the quote', '> ```\n> x\n> ```\nb', [{ kind: 'quote', text: '```\nx\n```' }]],
    [
      'indented code in the quote',
      '> a\n>\n>     code\nb',
      [{ kind: 'quote', text: 'a\n\n    code' }]
    ],
    ['a quote in the quote', '> a\n> > q\nb', [{ kind: 'quote', text: 'a\n> q' }]]
  ])('leaves a line after %s out of the quote', (_name, markdown, quote) => {
    expect(parseMarkdownBlocks(markdown)).toEqual([...quote, { kind: 'paragraph', text: 'b' }])
  })

  it.each([
    ['a heading', '> a\n# h', { kind: 'heading', level: 1, text: 'h' }],
    ['a list', '> a\n- b', { kind: 'list', ordered: false, items: ['b'] }],
    ['a rule', '> a\n***', { kind: 'hr' }]
  ])('ends the quote at %s', (_name, markdown, after) => {
    expect(parseMarkdownBlocks(markdown)).toEqual([{ kind: 'quote', text: 'a' }, after])
  })
})
