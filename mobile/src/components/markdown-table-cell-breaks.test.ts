import { describe, expect, it } from 'vitest'
import { markdownPlainText } from './markdown-plain-text'
import { parseMobileMarkdown } from './mobile-markdown-parser'
import { normalizeMobileMarkdownPreviewHtml } from './mobile-markdown-preview-html'
import { parseMarkdownBlocks } from './pr-sidebar/markdown-blocks'

// Review, 2026-09-30: bots and agents write a multi-line table cell as
// '| a.ts | one<br>two |'. The <br> became a newline before the table was
// read, in the chat's HTML pass and in the PR reader's lexer, so the row was
// cut in two: the cell lost "two", which became a bogus row of its own, and
// the reply's Copy was wrong too. The drawing is pinned in
// MobileMarkdown.table-cell-breaks.test.tsx and
// pr-sidebar/CommentMarkdown.table-cell-breaks.test.tsx.

const TABLE = '| File | Note |\n|---|---|\n| a.ts | one<br>two |\n| b.ts | ok |'

function chatTable(text: string) {
  const blocks = parseMobileMarkdown(normalizeMobileMarkdownPreviewHtml(text))
  const table = blocks.find((block) => block.type === 'table')
  expect(table, JSON.stringify(blocks)).toBeDefined()
  return table as Extract<typeof table, { type: 'table' }>
}

function prTable(text: string) {
  const blocks = parseMarkdownBlocks(text)
  const table = blocks.find((block) => block.kind === 'table')
  expect(table, JSON.stringify(blocks)).toBeDefined()
  return table as Extract<typeof table, { kind: 'table' }>
}

describe('a <br> in a table cell', () => {
  it('keeps the row whole and breaks the line inside the cell, in a chat reply', () => {
    const table = chatTable(TABLE)
    expect(table.headers).toEqual(['File', 'Note'])
    expect(table.rows).toEqual([
      ['a.ts', 'one\ntwo'],
      ['b.ts', 'ok']
    ])
  })

  it('keeps the row whole and breaks the line inside the cell, in a PR comment', () => {
    const table = prTable(TABLE)
    expect(table.rows).toEqual([
      ['a.ts', 'one\ntwo'],
      ['b.ts', 'ok']
    ])
  })

  it('copies the row on one line, the cell\'s break a space', () => {
    expect(markdownPlainText(TABLE)).toBe('File\tNote\na.ts\tone two\nb.ts\tok')
  })

  it('reads every spelling of the tag, and one in a header cell', () => {
    const text = '| File<BR>name | Note |\n|---|---|\n| a | x<br/>y<br />z |'
    expect(chatTable(text).headers).toEqual(['File\nname', 'Note'])
    expect(chatTable(text).rows).toEqual([['a', 'x\ny\nz']])
    expect(prTable(text).headers).toEqual(['File\nname', 'Note'])
    expect(prTable(text).rows).toEqual([['a', 'x\ny\nz']])
  })

  it('keeps a <br> in a code span in a cell as written', () => {
    const text = '| a | `x<br>y` |\n|---|---|\n| b | c |'
    expect(chatTable(text).headers).toEqual(['a', '`x<br>y`'])
    expect(prTable(text).headers).toEqual(['a', '`x<br>y`'])
    expect(markdownPlainText(text)).toBe('a\tx<br>y\nb\tc')
  })

  it('leaves a row with no <br> as it was', () => {
    expect(chatTable('| a | b |\n|---|---|\n| c | d |').rows).toEqual([['c', 'd']])
    expect(prTable('| a | b |\n|---|---|\n| c | d |').rows).toEqual([['c', 'd']])
  })

  it('reads a one-row table, and a <br> at the start or end of a cell', () => {
    const text = '| h | i |\n|---|---|\n| <br>a | b<br> |'
    expect(chatTable(text).rows).toEqual([['\na', 'b\n']])
    expect(prTable(text).rows).toEqual([['\na', 'b\n']])
    expect(markdownPlainText(text)).toBe('h\ti\na\tb')
  })

  it('still breaks a line with a pipe that is no table row', () => {
    expect(parseMarkdownBlocks('a | b<br>c')).toEqual([{ kind: 'paragraph', text: 'a | b\nc' }])
  })

  // A row the stand-in is kept for, but that the block reader then reads as
  // something else, must still draw a line break and never the stand-in.
  it('never draws the stand-in where a kept row is read as prose', () => {
    // marked needs as many delimiter cells as header cells; this has fewer.
    const chat = parseMobileMarkdown(normalizeMobileMarkdownPreviewHtml('| a | b<br>c |\n|---|'))
    expect(JSON.stringify(chat)).not.toMatch(/[\uE000-\uF8FF]/)
    expect(JSON.stringify(chat)).toContain('b\\nc')
    // A list item's wrapped lines take the rows before the table reader can.
    const pr = parseMarkdownBlocks('- a\n  | x<br>y |\n  |---|')
    expect(JSON.stringify(pr)).not.toMatch(/[\uE000-\uF8FF]/)
    expect(JSON.stringify(pr)).toContain('x\\ny')
    expect(markdownPlainText('| a | b<br>c |\n|---|')).not.toMatch(/[\uE000-\uF8FF]/)
  })
})
