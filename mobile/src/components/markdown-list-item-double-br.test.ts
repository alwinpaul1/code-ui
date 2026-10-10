import { describe, expect, it } from 'vitest'
import { markdownPlainText } from './markdown-plain-text'
import { parseMobileMarkdown } from './mobile-markdown-parser'
import { normalizeMobileMarkdownPreviewHtml } from './mobile-markdown-preview-html'

// Review, 2026-09-30 (fix round 3): bots write '<br><br>' as a paragraph gap
// inside a bullet. The chat's HTML pass turned each <br> into a hard break,
// two spaces and a newline, so two in a row left a whitespace-only line,
// which ended the list: '1. a<br><br>b\n2. c' drew the list [a] and the
// paragraph "b 2. c", the "2." marker lost as plain text, and
// '- a<br><br>b\n- c' drew a list, a paragraph and a second list, copied as
// '• a\n\nb\n\n• c'. GitHub, and the PR reader, draw one list with b inside
// item 1 after a gap. A single <br> in an item is pinned in
// markdown-br-line-breaks.test.ts, a table cell's in
// markdown-table-cell-breaks.test.ts.

const blocks = (text: string) => parseMobileMarkdown(normalizeMobileMarkdownPreviewHtml(text))
const bullet = (text: string) => ({ text, depth: 0, ordered: false })
const numbered = (text: string, number: number) => ({ text, depth: 0, ordered: true, number })

describe('a double <br> inside a chat list item', () => {
  it('keeps a numbered list one list, with b under item 1 after a gap and 2. still a marker', () => {
    expect(blocks('1. a<br><br>b\n2. c')).toEqual([
      { type: 'list', ordered: true, items: [numbered('a\n\nb', 1), numbered('c', 2)] }
    ])
    expect(markdownPlainText('1. a<br><br>b\n2. c')).toBe('1. a\n\n  b\n2. c')
  })

  it('keeps a bulleted list one list, on screen and in the Copy', () => {
    expect(blocks('- a<br><br>b\n- c')).toEqual([{ type: 'list', ordered: false, items: [bullet('a\n\nb'), bullet('c')] }])
    expect(markdownPlainText('- a<br><br>b\n- c')).toBe('• a\n\n  b\n• c')
  })

  it('keeps a one-item list one item', () => {
    expect(blocks('- a<br><br>b')).toEqual([{ type: 'list', ordered: false, items: [bullet('a\n\nb')] }])
    expect(markdownPlainText('- a<br><br>b')).toBe('• a\n\n  b')
  })

  it('keeps the gap on a wrapped line of an item, a nested item and a task', () => {
    expect(blocks('- a\n  b<br><br>c\n- d')).toEqual([
      { type: 'list', ordered: false, items: [bullet('a b\n\nc'), bullet('d')] }
    ])
    expect(markdownPlainText('- a\n  - b<br><br>c\n- d')).toBe('• a\n  ◦ b\n\n    c\n• d')
    expect(blocks('- [ ] a<br><br>b')).toEqual([
      { type: 'list', ordered: false, items: [{ ...bullet('a\n\nb'), checked: false }] }
    ])
  })

  it('draws no blank line for a double <br> ending the last item', () => {
    expect(blocks('- a\n- b<br><br>')).toEqual([{ type: 'list', ordered: false, items: [bullet('a'), bullet('b')] }])
    expect(blocks('- a<br><br>')).toEqual([{ type: 'list', ordered: false, items: [bullet('a')] }])
    expect(markdownPlainText('- a<br><br>')).toBe('• a')
  })

  // The chat draws no bullet for an item with no words of its own
  // (flattenList), and an item that is only a <br> has none.
  it('reads an item that is only a <br> as the empty item it draws', () => {
    expect(blocks('- <br>')).toEqual(blocks('-'))
    expect(blocks('- <br>\n- b')).toEqual(blocks('-\n- b'))
    expect(blocks('1. <br><br>\n2. b')).toEqual(blocks('1.\n2. b'))
    expect(markdownPlainText('- <br>')).toBe('')
  })

  it('keeps a quote one quote across a double <br>', () => {
    expect(blocks('> a<br><br>b')).toEqual([{ type: 'quote', members: [{ type: 'paragraph', text: 'a\n\nb' }] }])
  })

  // A list or a heading inside a quote is drawn as a list or a heading inside
  // its bar (mobile-markdown-quote-blocks.ts), and a link definition as its
  // source, so a <br> kept on a quote's line has to be a line break there
  // too, never the stand-in the HTML pass left.
  it('draws a <br> in a list or a heading inside a quote as a break, never its stand-in', () => {
    expect(blocks('> - a<br>b\n> - c')).toEqual([
      { type: 'quote', members: [{ type: 'list', ordered: false, items: [bullet('a\nb'), bullet('c')] }] }
    ])
    expect(blocks('> [a]: https://x.dev<br>')).toEqual([
      { type: 'quote', members: [{ type: 'paragraph', text: '[a]: https://x.dev' }] }
    ])
    for (const text of ['> - a<br><br>b\n> - c', '> # T<br>sub', '> 1. a<br>2. b', '> | a | b |\n> | - | - |\n> | x<br>y | z |']) {
      expect(JSON.stringify(blocks(text)), text).not.toContain('\uE000')
      expect(markdownPlainText(text), text).not.toContain('\uE000')
    }
  })

  // A line the HTML pass takes for an item's or a quote's can still reach
  // marked as a fence it missed (one in a quote in an item) or as a
  // paragraph after the item's end: its <br> is a line break there too.
  it('never draws the stand-in in a code block or an image a kept line reached', () => {
    expect(blocks('- > ```\n  > x<br>y\n  > ```')).toEqual([
      { type: 'code', text: 'x\ny', closed: true, quoted: true }
    ])
    for (const text of ['- > ```\n  > x<br>y\n  > ```', '- a\n```\nx\n```\n![x<br>y](u.png)']) {
      expect(JSON.stringify(blocks(text)), text).not.toContain('\uE000')
      expect(markdownPlainText(text), text).not.toContain('\uE000')
    }
  })

  // A heading or a rule ends a paragraph, so the line after one is no lazy
  // line of the item above it, and its <br><br> is the paragraph break it
  // always was.
  it('reads a paragraph after a heading or a rule under an item as its own', () => {
    for (const between of ['# h', '---']) {
      expect(blocks(`- a\n${between}\nb<br><br>c`).slice(-2), between).toEqual([
        { type: 'paragraph', text: 'b' },
        { type: 'paragraph', text: 'c' }
      ])
    }
  })
})

// The sweep of the last round: a <br> right before a marker, a quote's `>`
// or a heading's `#` is a break inside the block, and what follows it is
// its words, as GitHub and the PR reader draw it. The chat drew a second
// item, a list under a quote and a heading under the list.
describe('a <br> before a block marker inside a chat item or quote', () => {
  it('keeps the words after it in the item or the quote', () => {
    expect(blocks('- a<br>- b')).toEqual([{ type: 'list', ordered: false, items: [bullet('a\n- b')] }])
    expect(blocks('1. a<br>2. b')).toEqual([{ type: 'list', ordered: true, items: [numbered('a\n2. b', 1)] }])
    expect(blocks('> a<br>- b')).toEqual([{ type: 'quote', members: [{ type: 'paragraph', text: 'a\n- b' }] }])
    expect(blocks('- a<br># h')).toEqual([{ type: 'list', ordered: false, items: [bullet('a\n# h')] }])
    expect(markdownPlainText('- a<br>- b')).toBe('• a\n  - b')
  })
})

describe('a <br> the change leaves as it was', () => {
  it('still reads two <br> in a plain paragraph as a paragraph break', () => {
    expect(blocks('a<br><br>b')).toEqual([
      { type: 'paragraph', text: 'a' },
      { type: 'paragraph', text: 'b' }
    ])
  })

  it('still draws a single <br> in an item, with or without a newline after it', () => {
    expect(blocks('- a<br>b\n- c')).toEqual([{ type: 'list', ordered: false, items: [bullet('a\nb'), bullet('c')] }])
    expect(blocks('- a<br>\n  b')).toEqual([{ type: 'list', ordered: false, items: [bullet('a\nb')] }])
    expect(blocks('- a <br> b')).toEqual([{ type: 'list', ordered: false, items: [bullet('a\nb')] }])
  })

  it('keeps a <br> in code inside an item as written', () => {
    expect(blocks('- `a<br><br>b`\n- c')).toEqual([
      { type: 'list', ordered: false, items: [bullet('`a<br><br>b`'), bullet('c')] }
    ])
  })
})
