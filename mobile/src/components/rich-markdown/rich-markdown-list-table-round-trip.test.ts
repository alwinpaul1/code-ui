// @vitest-environment happy-dom
import { marked, type Tokens } from 'marked'
import { describe, expect, it } from 'vitest'
import { editedSurface, openedSurface, savedUntouched } from './rich-markdown-round-trip.test-support'

const TABLE = '<table><thead><tr><th>x</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>'

// Review, 2026-09-30: a table inside a list item ended the list, so a save wrote it at the margin:
// '- a\n\n  | x |\n  |---|\n  | 1 |' saved as '- a\n\n| x |\n|---|\n| 1 |', no longer the item's, and a
// list with an item after it split in two. A table straight under the item's words was read as
// more words ('- a | x | |---| | 1 |'). The item now holds the table (a `<table>` inside the
// `<li>`), and a save writes every line of it at the item's content column.
describe('a table inside a list item', () => {
  it.each([
    ['after a blank line under a bullet', '- a\n\n  | x |\n  |---|\n  | 1 |'],
    ['under an ordered item', '1. a\n\n   | x |\n   |---|\n   | 1 |'],
    ['under an item numbered past 9', '10. a\n\n    | x | y |\n    |---|---|\n    | 1 | 2 |\n11. b'],
    ['followed by a second item', '- a\n\n  | x |\n  |---|\n  | 1 |\n- b'],
    ['with an aligned separator', '- a\n\n  | x | y |\n  |:---:|---:|\n  | 1 | 2 |'],
    ['of the header row alone', '- a\n\n  | x |\n  |---|'],
    ['of one body row', '1. a\n\n   | x |\n   | --- |\n   | 1 |'],
    ['straight under the item’s words', '- a\n  | x |\n  |---|\n  | 1 |'],
    ['written without outer pipes', '- a\n\n  x | y\n  --- | ---\n  1 | 2'],
    ['with a cell holding an escaped pipe', '- a\n\n  | a \\| b |\n  |---|'],
    ['in a nested item', '- a\n  - b\n\n    | x |\n    |---|\n    | 1 |\n- c'],
    ['after a nested list, in the outer item', '- a\n  - b\n\n  | x |\n  |---|'],
    ['before a nested list', '- a\n\n  | x |\n  |---|\n  - b'],
    ['followed by a paragraph of the item', '- a\n\n  | x |\n  |---|\n\n  more'],
    ['followed by a quote', '- a\n\n  | x |\n  |---|\n  > q'],
    ['after a quote', '- a\n  > q\n  | x |\n  |---|'],
    ['after a fence', '- a\n  ```\n  x\n  ```\n  | x |\n  |---|'],
    ['and a second table after a blank line', '- a\n\n  | x |\n  |---|\n\n  | y |\n  |---|'],
    ['under a task', '- [ ] a\n\n  | x |\n  |---|\n- [x] b'],
    ['as the whole item', '- | x |\n  |---|\n  | 1 |\n- b']
  ])('keeps a table %s', (_name, markdown) => {
    expect(savedUntouched(markdown)).toBe(markdown)
  })

  it('keeps a table inside a list item, drawn inside its item', () => {
    const { editor } = openedSurface('- a\n\n  | x |\n  |---|\n  | 1 |\n- b')
    const items = editor.querySelectorAll('ul > li')
    expect(items).toHaveLength(2)
    expect(items[0]!.querySelector(':scope > table td')?.textContent).toBe('1')
    expect(editor.querySelector(':scope > table')).toBeNull()
  })

  it('keeps the list one list, the table in its item, for a CommonMark reader once saved', () => {
    const saved = savedUntouched('1. a\n\n   | x |\n   |---|\n   | 1 |\n2. b')
    const lists = marked.lexer(saved).filter((token) => token.type === 'list') as Tokens.List[]
    expect(lists).toHaveLength(1)
    // A loose list, for the blank line, so marked calls the items' words paragraphs.
    expect(lists[0]!.items.map((item) => item.tokens.map((inner) => inner.type))).toEqual([
      ['paragraph', 'space', 'table'],
      ['paragraph']
    ])
  })

  it('keeps the table when a cell is edited', () => {
    const { editor, saved } = openedSurface('- a\n\n  | x |\n  |:-:|\n  | 1 |\n- b')
    editor.querySelector('li td')!.textContent = 'one'
    expect(saved()).toBe('- a\n\n  | x |\n  |:-:|\n  | one |\n- b')
  })

  it('writes a table the engine put in an item at the item’s content column', () => {
    expect(editedSurface(`<ol start="9"><li><p>a</p>${TABLE}</li></ol>`).saved()).toBe(
      '9. a\n   | x |\n   | --- |\n   | 1 |'
    )
  })

  it('keeps two tables the engine put side by side in an item apart', () => {
    // With no blank line between them the second header would be read as a row of the first.
    expect(editedSurface(`<ul><li><p>a</p>${TABLE}${TABLE}</li></ul>`).saved()).toBe(
      '- a\n  | x |\n  | --- |\n  | 1 |\n\n  | x |\n  | --- |\n  | 1 |'
    )
  })

  it('keeps a table the engine put after a nested list out of the nested item’s words', () => {
    // Straight under '  - b' the header would be the nested item's words, so it gets a blank line.
    expect(
      editedSurface(`<ul><li><p>a</p><ul><li><p>b</p></li></ul>${TABLE}</li></ul>`).saved()
    ).toBe('- a\n  - b\n\n  | x |\n  | --- |\n  | 1 |')
  })
})
