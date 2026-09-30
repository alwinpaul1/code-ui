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

  it('keeps a list item’s break as it was written before', () => {
    expect(editedSurface('<ul><li><p>a<br>b</p></li></ul>').saved()).toBe('- a\nb')
  })

  it('never breaks a table row at a cell’s break', () => {
    expect(
      editedSurface(
        '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>a<br>b<br></td></tr></tbody></table>'
      ).saved()
    ).toBe('| h |\n| --- |\n| a b |')
  })
})
