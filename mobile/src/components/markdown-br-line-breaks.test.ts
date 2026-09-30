import { describe, expect, it } from 'vitest'
import { markdownPlainText } from './markdown-plain-text'
import { parseMobileMarkdown } from './mobile-markdown-parser'
import { normalizeMobileMarkdownPreviewHtml } from './mobile-markdown-preview-html'

// Review, 2026-09-30: README-style HTML in a reply, 'Name: Ada<br>Role:
// Admin', lost the break its author asked for. The HTML pass turned <br> into
// a bare newline and the parser reflows a lone newline into a space, so the
// paragraph, and a list item, drew and copied on one line. A <br> is now a
// Markdown hard break. A <br> in a table cell is pinned in
// markdown-table-cell-breaks.test.ts; the drawing in
// MobileMarkdown.br-line-breaks.test.tsx.

const blocks = (text: string) => parseMobileMarkdown(normalizeMobileMarkdownPreviewHtml(text))

describe('a <br> outside a table in a chat reply', () => {
  it('breaks the line in a paragraph, on screen and in the Copy', () => {
    expect(blocks('Name: Ada<br>Role: Admin')).toEqual([{ type: 'paragraph', text: 'Name: Ada\nRole: Admin' }])
    expect(markdownPlainText('Name: Ada<br>Role: Admin')).toBe('Name: Ada\nRole: Admin')
  })

  it('reads every spelling of the tag', () => {
    for (const tag of ['<br>', '<br/>', '<br />', '<BR>', '<Br >']) {
      expect(markdownPlainText(`a${tag}b`), tag).toBe('a\nb')
    }
  })

  it('breaks the line in a list item, the rest indented under its words in the Copy', () => {
    expect(blocks('- Name: Ada<br>Role: Admin')).toMatchObject([
      { type: 'list', items: [{ text: 'Name: Ada\nRole: Admin', depth: 0 }] }
    ])
    expect(markdownPlainText('- Name: Ada<br>Role: Admin')).toBe('• Name: Ada\n  Role: Admin')
    expect(markdownPlainText('1. a<br>b\n2. c')).toBe('1. a\n  b\n2. c')
    expect(markdownPlainText('- a\n  - b<br>c')).toBe('• a\n  ◦ b\n    c')
  })

  it('breaks the line in a quote and in an HTML paragraph', () => {
    expect(blocks('> a<br>b')).toMatchObject([{ type: 'quote', text: 'a\nb' }])
    expect(blocks('<p align="center">Bold<br/>subtitle</p>')).toEqual([{ type: 'paragraph', text: 'Bold\nsubtitle' }])
  })

  it('keeps a heading\'s break inside the heading', () => {
    expect(blocks('# Title<br>sub')).toEqual([{ type: 'heading', level: 1, text: 'Title\nsub' }])
    expect(blocks('<h2>Bold<br/>subtitle</h2>')).toEqual([{ type: 'heading', level: 2, text: 'Bold\nsubtitle' }])
    expect(markdownPlainText('# Title<br>sub')).toBe('Title\nsub')
  })

  it('keeps a <br> in a code span or a fence as written', () => {
    expect(blocks('a `x<br>y` b')).toEqual([{ type: 'paragraph', text: 'a `x<br>y` b' }])
    expect(markdownPlainText('a `x<br>y` b')).toBe('a x<br>y b')
    expect(markdownPlainText('```\na<br>b\n```')).toBe('a<br>b')
    expect(markdownPlainText('\\<br> stays')).toBe('<br> stays')
  })

  it('adds no blank line for a <br> at the very start or end of the text', () => {
    expect(blocks('a<br>')).toEqual([{ type: 'paragraph', text: 'a' }])
    expect(blocks('<br>a')).toEqual([{ type: 'paragraph', text: 'a' }])
    expect(markdownPlainText('a<br>')).toBe('a')
    expect(markdownPlainText('<br>')).toBe('')
  })

  // Pinned as it read before: two <br> in a row, or a <br> ending its line,
  // leave a blank line, which ends the paragraph.
  it('reads two <br> in a row, and a <br> before a newline, as a paragraph break', () => {
    expect(blocks('a<br><br>b')).toEqual([
      { type: 'paragraph', text: 'a' },
      { type: 'paragraph', text: 'b' }
    ])
    expect(blocks('a<br>\nb')).toEqual([
      { type: 'paragraph', text: 'a' },
      { type: 'paragraph', text: 'b' }
    ])
    expect(markdownPlainText('a<br><br>b')).toBe('a\n\nb')
  })

  // A proven limit, pinned: an italic does not cross a line break in the
  // chat's emphasis grammar (markdownInlineTokenPattern), the same as around
  // a two-space hard break already. The words and the break survive; the
  // stars stay. A bold does cross one.
  it('keeps the words and the break of an italic around a <br>, though not the italic', () => {
    expect(markdownPlainText('*a<br>b*')).toBe('*a\nb*')
    expect(markdownPlainText('*a  \nb*')).toBe('*a\nb*')
    expect(markdownPlainText('**a<br>b**')).toBe('a\nb')
  })
})
