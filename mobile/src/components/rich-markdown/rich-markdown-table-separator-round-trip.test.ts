// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { editedSurface, openedSurface, savedUntouched } from './rich-markdown-round-trip.test-support'

// Review, 2026-09-30: a table whose separator row used one or two dashes per cell, or colons, was
// not a table to the editor, which asked for three dashes (/^:?-{3,}:?$/). GFM asks for one, and
// the desktop (marked) and the chat draw these as tables. The phone read the rows as a paragraph
// and its reflow joined them, so `| a | b |\n| - | - |\n| 1 | 2 |` saved as
// `| a | b | | - | - | | 1 | 2 |` and the table was gone for everyone. The writer also wrote every
// separator as `---`, which dropped the alignment of `|:-:|--:|`.
describe('a table whose separator row is short or aligned', () => {
  it.each([
    ['one dash a cell', '| a | b |\n| - | - |\n| 1 | 2 |'],
    ['two dashes a cell', '| a | b |\n| -- | -- |\n| 1 | 2 |'],
    ['alignment colons with no spaces', '| a | b |\n|:-:|--:|\n| 1 | 2 |'],
    ['alignment on the usual dashes', '| a | b | c |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |'],
    ['no leading or trailing pipes', 'a | b\n--|--\n1 | 2'],
    ['one column', '| a |\n| - |\n| 1 |'],
    ['a header and no rows', '| a | b |\n| - | - |']
  ])('stays a table, and a save writes %s back as it was', (_name, markdown) => {
    const { editor, saved } = openedSurface(markdown)
    expect(editor.querySelector('table')).not.toBeNull()
    expect(saved()).toBe(markdown)
  })

  it('keeps the separator row as written when a cell is edited', () => {
    const { editor, saved } = openedSurface('| a | b |\n|:-:|--:|\n| 1 | 2 |')
    editor.querySelector('td')!.textContent = 'one'
    expect(saved()).toBe('| a | b |\n|:-:|--:|\n| one | 2 |')
  })

  it('writes a separator of the right width once the table has lost a column', () => {
    // The row it remembers has two cells and the table one: writing it would make the header a
    // one-column table under a two-column separator, which GFM does not read as a table.
    const { editor, saved } = openedSurface('| a | b |\n|:-:|--:|\n| 1 | 2 |')
    editor.querySelectorAll('tr').forEach((row) => row.lastElementChild!.remove())
    expect(saved()).toBe('| a |\n| --- |\n| 1 |')
  })

  it('writes a table without outer pipes with them once a row starts or ends empty', () => {
    // `| 2` would read as a leading pipe and one cell; the empty cell would be lost.
    const { editor, saved } = openedSurface('a | b\n--|--\n1 | 2')
    editor.querySelector('td')!.textContent = ''
    expect(saved()).toBe('| a | b |\n--|--\n|  | 2 |')
  })

  it('writes a table the toolbar made, which remembers nothing, with --- separators', () => {
    expect(
      editedSurface(
        '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>'
      ).saved()
    ).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |')
  })

  it.each([
    // A lone dash under a line is a setext underline or text, never a one-column separator.
    ['a lone dash under a piped line', 'a | b\n-'],
    ['a separator narrower than its header', '| a | b |\n| - |\n| 1 | 2 |'],
    ['a separator with words in it', '| a | b |\n| - | x |']
  ])('reads %s as no table', (_name, markdown) => {
    expect(openedSurface(markdown).editor.querySelector('table')).toBeNull()
  })

  it('still reads the three-dash separator it always has', () => {
    const markdown = '| a | b |\n| --- | --- |\n| 1 | 2 |'
    expect(savedUntouched(markdown)).toBe(markdown)
  })
})
