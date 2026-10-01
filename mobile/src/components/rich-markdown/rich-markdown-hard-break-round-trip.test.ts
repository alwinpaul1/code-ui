// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { editedSurface, openedSurface, savedUntouched } from './rich-markdown-round-trip.test-support'

// Review, 2026-09-30: the loader draws a hard break, two trailing spaces or a trailing backslash,
// as a <br>, and the writer wrote every <br> as a bare newline, which is a soft break: 'a  \nb' and
// 'a\\\nb' both saved as 'a\nb', and the break was gone on GitHub, in the chat and on the phone's
// own reload. A break in a paragraph is now written as a hard break: in the form its source used,
// where the paragraph remembers it, and as a backslash for one the user types.
describe('a hard line break in a paragraph', () => {
  it.each([
    ['two trailing spaces', 'a  \nb'],
    ['a trailing backslash', 'a\\\nb'],
    ['both forms in one paragraph', 'a  \nb\\\nc  \nd'],
    ['a break inside bold', '**a  \nb**'],
    ['an entity before a break', 'a &lt;\\\nb'],
    ['a break between two paragraphs', 'one  \ntwo\n\nthree\\\nfour']
  ])('saves %s back as written', (_name, markdown) => {
    const { editor, saved } = openedSurface(markdown)
    expect(editor.querySelector('br')).not.toBeNull()
    expect(saved()).toBe(markdown)
  })

  it('writes a break of three spaces with the two a break needs', () => {
    expect(savedUntouched('a   \nb')).toBe('a  \nb')
  })

  it('writes a break the user types as a backslash, which reads back as the same break', () => {
    const saved = editedSurface('<p>a<br>b</p>').saved()
    expect(saved).toBe('a\\\nb')
    const reopened = openedSurface(saved)
    expect(reopened.editor.innerHTML).toBe('<p>a<br>b</p>')
    expect(reopened.saved()).toBe(saved)
  })

  it('writes nothing for the break an engine leaves at a paragraph’s end', () => {
    expect(editedSurface('<p>a<br></p>').saved()).toBe('a')
    expect(editedSurface('<p>a<br><br></p>').saved()).toBe('a')
    expect(editedSurface('<p>a <strong>b<br></strong></p>').saved()).toBe('a **b**')
    expect(editedSurface('<p><br></p>').saved()).toBe('')
  })

  it('writes two breaks in a row as backslashes, since a line of spaces is a blank line', () => {
    const saved = editedSurface('<p data-md-breaks="spaces spaces">a<br><br>b</p>').saved()
    expect(saved).toBe('a\\\n\\\nb')
    expect(openedSurface(saved).editor.querySelectorAll('br')).toHaveLength(2)
  })

  it('writes a break after a backslash with spaces, so the backslash stays one', () => {
    const saved = editedSurface('<p>C:\\<br>next</p>').saved()
    expect(saved).toBe('C:\\  \nnext')
    const reopened = openedSurface(saved).editor.querySelector('p')!
    expect(reopened.textContent).toBe('C:\\next')
    expect(reopened.querySelectorAll('br')).toHaveLength(1)
  })

  it('writes a bare newline before a line that opens a block, rather than a stray backslash', () => {
    expect(editedSurface('<p>a<br># b</p>').saved()).toBe('a\n# b')
  })

  it('keeps the remembered forms when the words beside them are edited', () => {
    const { editor, saved } = openedSurface('a  \nb')
    editor.querySelector('p')!.lastChild!.textContent = 'b, edited'
    expect(saved()).toBe('a  \nb, edited')
  })

  it('writes every break as a backslash once the paragraph has more breaks than it remembers', () => {
    // Enter clones the paragraph and its attribute; which break was which is no longer known.
    expect(editedSurface('<p data-md-breaks="spaces">a<br>b<br>c</p>').saved()).toBe('a\\\nb\\\nc')
  })
})

describe('a break outside a paragraph', () => {
  it('keeps a quote’s lines as lines', () => {
    expect(savedUntouched('> a\n> b')).toBe('> a\n> b')
    expect(savedUntouched('> a  \n> b')).toBe('> a  \n> b')
    expect(savedUntouched('> a\n>\n> b')).toBe('> a\n>\n> b')
    expect(editedSurface('<blockquote><p>a<br>b</p></blockquote>').saved()).toBe('> a\n> b')
  })


  it('never breaks a table row at a cell’s break', () => {
    expect(
      editedSurface(
        '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>a<br>b<br></td></tr></tbody></table>'
      ).saved()
    ).toBe('| h |\n| --- |\n| a b |')
  })
})

// 2026-10-01: a hard break in a list item loaded as a newline in the item's text, drawn as a space,
// and the writer put it back bare and at the margin, so '- a  \n  b' saved as '- a\nb': a lazy
// line, one item reading 'a b', the break gone. A middle line's trailing spaces were trimmed before
// they were read, so '- a\n  b  \n  c' lost its break on load. An item's break is now a <br>, its
// form remembered, and written as a hard break at the item's indent.
describe('a hard line break in a list item', () => {
  it.each([
    ['two trailing spaces', '- a  \n  b'],
    ['a trailing backslash', '- a\\\n  b'],
    ['an ordered item', '1. a  \n   b'],
    ['an item before another', '- a  \n  b\n- c'],
    ['a nested item', '- x\n  - a  \n    b'],
    ['a task item', '- [ ] a  \n  b'],
    ['a later paragraph of an item', '- a\n\n  b  \n  c']
  ])('saves %s back as written', (_name, markdown) => {
    const { editor, saved } = openedSurface(markdown)
    expect(editor.querySelector('li br')).not.toBeNull()
    expect(saved()).toBe(markdown)
  })

  // The soft line before it joins, as a soft line in an item always has ('- a\n  b' saves as
  // '- a b'); the break after it is what was lost.
  it('keeps a break on an item’s middle line', () => {
    const { editor, saved } = openedSurface('- a\n  b  \n  c')
    expect(editor.querySelectorAll('li br')).toHaveLength(1)
    expect(saved()).toBe('- a b  \n  c')
  })

  it('writes a break the user types in an item as a backslash at the item’s indent', () => {
    const saved = editedSurface('<ul><li><p>a<br>b</p></li></ul>').saved()
    expect(saved).toBe('- a\\\n  b')
    const reopened = openedSurface(saved)
    expect(reopened.editor.querySelectorAll('li br')).toHaveLength(1)
    expect(reopened.saved()).toBe(saved)
  })

  it('writes the break at the marker’s width for a numbered item, and in an item with no paragraph', () => {
    expect(editedSurface('<ol><li><p>a<br>b</p></li></ol>').saved()).toBe('1. a\\\n   b')
    expect(editedSurface('<ul><li>a<br>b</li></ul>').saved()).toBe('- a\\\n  b')
  })

  it('still joins a soft line in an item, which is no break', () => {
    const { editor, saved } = openedSurface('- a\n  b')
    expect(editor.querySelector('li br')).toBeNull()
    expect(saved()).toBe('- a b')
  })

  it('degenerate: writes nothing for the break an engine leaves at an item’s end', () => {
    expect(editedSurface('<ul><li><p>a<br></p></li></ul>').saved()).toBe('- a')
    expect(editedSurface('<ul><li><p><br></p></li></ul>').saved()).toBe('-')
  })
})
