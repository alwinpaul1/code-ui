import { describe, expect, it } from 'vitest'
import { parseMarkdownBlocks, type MarkdownBlock } from './markdown-blocks'

// Review, 2026-09-30: review bots write '- item<br>detail' and
// '1. **File**<br>`x.ts`'. The PR reader turned every <br> off a table row
// into a newline before it read the lines, so the words after it were a
// paragraph at the margin and the rest of the list a second list: a numbered
// list broke in two and counted again from 2. '> a<br>b' was a quote and a
// paragraph, '## T<br>sub' a heading and a paragraph. GitHub, and the chat,
// draw a break inside the item, the quote or the heading. The drawing is
// pinned in CommentMarkdown.item-breaks.test.tsx.

const list = (items: string[], ordered = false): MarkdownBlock => ({ kind: 'list', ordered, items })

/** Every private-use character: the lexer's stand-ins, none of which may be drawn. */
const STAND_IN = /[-]/

function blocks(text: string): MarkdownBlock[] {
  const read = parseMarkdownBlocks(text)
  expect(JSON.stringify(read), text).not.toMatch(STAND_IN)
  return read
}

describe('a <br> in a PR comment\'s list item, quote or heading', () => {
  it('keeps a bulleted item whole, the words after the break inside it', () => {
    expect(blocks('- a<br>b\n- c')).toEqual([list(['a\nb', 'c'])])
  })

  it('keeps a numbered list one list, counting from 1', () => {
    expect(blocks('1. a<br>b\n2. c\n3. d')).toEqual([list(['a\nb', 'c', 'd'], true)])
  })

  it('keeps a review bot\'s file list one list', () => {
    const text = '1. **File**<br>`x.ts`\n2. **Other**<br>`y.ts`'
    expect(blocks(text)).toEqual([list(['**File**\n`x.ts`', '**Other**\n`y.ts`'], true)])
  })

  it('keeps a quote one quote', () => {
    expect(blocks('> a<br>b')).toEqual([{ kind: 'quote', text: 'a\nb' }])
  })

  it('keeps a heading one heading', () => {
    expect(blocks('## T<br>sub')).toEqual([{ kind: 'heading', level: 2, text: 'T\nsub' }])
  })

  it('keeps a wrapped item whole when its second line holds the break', () => {
    expect(blocks('- a\n  b<br>c\n- d')).toEqual([list(['a b\nc', 'd'])])
  })

  it('keeps a nested item whole under its parent', () => {
    expect(blocks('- a\n  - b<br>c\n- d')).toEqual([
      {
        kind: 'list',
        ordered: false,
        items: ['a', 'b\nc', 'd'],
        shapes: [
          { depth: 0, ordered: false },
          { depth: 1, ordered: false },
          { depth: 0, ordered: false }
        ]
      }
    ])
  })

  it('keeps an item whole inside a collapsible', () => {
    expect(blocks('<details><summary>s</summary>\n\n1. a<br>b\n2. c\n\n</details>')).toEqual([
      { kind: 'details', summary: 's', body: [list(['a\nb', 'c'], true)] }
    ])
  })

  it('reads a one-item list', () => {
    expect(blocks('- a<br>b')).toEqual([list(['a\nb'])])
    expect(blocks('1. a<br>b')).toEqual([list(['a\nb'], true)])
  })

  it('draws no blank line for a break at the start or end of an item, a quote or a heading', () => {
    expect(blocks('- <br>a\n- b<br>')).toEqual([list(['a', 'b'])])
    expect(blocks('> <br>a<br>')).toEqual([{ kind: 'quote', text: 'a' }])
    expect(blocks('# <br>T<br>')).toEqual([{ kind: 'heading', level: 1, text: 'T' }])
  })

  it('reads an item that is only a break as an empty item', () => {
    expect(blocks('- <br>\n- b')).toEqual([list(['', 'b'])])
    expect(blocks('1. <br>')).toEqual([list([''], true)])
  })

  it('reads a break before a newline, and spaces around one, as one line break', () => {
    expect(blocks('- a<br>\n  b')).toEqual([list(['a\nb'])])
    expect(blocks('> a<br>\n> b')).toEqual([{ kind: 'quote', text: 'a\nb' }])
    expect(blocks('- a <br> b')).toEqual([list(['a\nb'])])
  })

  it('keeps two breaks in a row as a blank line inside the item', () => {
    expect(blocks('- a<br><br>b\n- c')).toEqual([list(['a\n\nb', 'c'])])
  })

  // GitHub reads it this way: a <br> never opens a block.
  it('keeps a marker after a break as words inside the item', () => {
    expect(blocks('- a<br>- b')).toEqual([list(['a\n- b'])])
  })

  it('keeps a <br> in a code span or a fence under the item as written', () => {
    expect(blocks('- `a<br>b` c<br>d')).toEqual([list(['`a<br>b` c\nd'])])
    expect(blocks('- a<br>b\n  ```\n  x<br>y\n  ```')).toEqual([list(['a\nb']), { kind: 'code', text: 'x<br>y', lang: '' }])
  })

  it('reads a paragraph\'s break as it did', () => {
    expect(blocks('a<br>b\n\n- c')).toEqual([{ kind: 'paragraph', text: 'a\nb' }, list(['c'])])
  })
})
