// @vitest-environment happy-dom
import { marked, type Tokens } from 'marked'
import { describe, expect, it } from 'vitest'
import { editedSurface, openedSurface, savedUntouched } from './rich-markdown-round-trip.test-support'

const html = (source: string) => marked.parse(source, { async: false })

// Review, 2026-09-30: a quote inside a list item was taken for more of the item's words, so
// '- a\n  > quote' saved as '- a > quote': the quote was gone and a stray '>' sat in the item's
// text. The item now holds the quote (a `<blockquote>` inside the `<li>`), as it holds a fence, and
// a save writes it back at the item's content column behind '> '.
describe('a quote inside a list item', () => {
  it.each([
    ['under a bullet', '- a\n  > quote'],
    ['under an ordered item', '1. a\n   > quote'],
    ['under an item numbered past 9', '10. a\n    > quote\n11. b'],
    ['of two lines', '- a\n  > q1\n  > q2\n- b'],
    ['of two paragraphs', '- a\n  > q1\n  >\n  > q2'],
    ['that is empty', '- a\n  >'],
    ['after a blank line in the item', '- a\n\n  > quote\n- b'],
    ['holding a fence', '- a\n  > ```\n  > x\n  > ```\n- b'],
    ['holding words and a fence', '1. a\n   > note\n   > ```sh\n   > ls\n   > ```'],
    ['one column past the item’s words', '- a\n   > quote'],
    ['in a nested item', '- a\n  - b\n    > q\n- c'],
    ['after a nested list, in the outer item', '- a\n  - b\n  > q'],
    ['before a nested list', '- a\n  > q\n  - b'],
    ['under a task', '- [ ] a\n  > q\n- [x] b'],
    ['followed by a paragraph of the item', '- a\n  > q\n\n  more'],
    ['followed by a line with no marker', '- a\n  > q1\n  q2'],
    ['and a second quote after a blank line', '- a\n  > q1\n\n  > q2'],
    ['followed by a fence', '- a\n  > q\n  ```\n  x\n  ```'],
    ['as the whole item', '- > quote'],
    ['as the whole ordered item, over two lines', '1. > a\n   > b'],
    ['as the whole item, holding a fence', '- > ```\n  > x\n  > ```\n- b']
  ])('keeps a quote %s', (_name, markdown) => {
    expect(savedUntouched(markdown)).toBe(markdown)
  })

  it('keeps a blockquote inside a list item, drawn inside its item', () => {
    const { editor } = openedSurface('- a\n  > quote\n- b')
    const items = editor.querySelectorAll('ul > li')
    expect(items).toHaveLength(2)
    expect(items[0]!.querySelector(':scope > p')?.textContent).toBe('a')
    expect(items[0]!.querySelector(':scope > blockquote')?.textContent).toBe('quote')
  })

  it('draws an item that is only a quote with no words beside the quote', () => {
    const { editor } = openedSurface('- > quote')
    const item = editor.querySelector('ul > li')!
    expect(Array.from(item.children).map((child) => child.tagName)).toEqual(['BLOCKQUOTE'])
  })

  it('keeps the quote in the item for a CommonMark reader once saved', () => {
    const saved = savedUntouched('1. a\n   > q\n2. b')
    const list = marked.lexer(saved).find((token) => token.type !== 'space') as Tokens.List
    expect(list.type).toBe('list')
    expect(list.items.map((item) => item.tokens.map((inner) => inner.type))).toEqual([
      ['text', 'blockquote'],
      ['text']
    ])
  })

  it('ends the item at a quote written left of its words, which is the document’s', () => {
    // marked reads '- a\n > q' as a list and then a quote, as CommonMark does: one column is left
    // of the item's words, and a quote is not words that may continue a paragraph lazily.
    const markdown = '- a\n > quote'
    const { editor, saved } = openedSurface(markdown)
    expect(editor.querySelector('li')?.textContent).toBe('a')
    expect(saved()).toBe('- a\n\n> quote')
    expect(html(saved())).toBe(html(markdown))
  })

  it('keeps the quote when the item’s words are edited, and the words when the quote is', () => {
    const { editor, saved } = openedSurface('- a\n  > q\n- b')
    editor.querySelector('li > p')!.textContent = 'a, edited'
    editor.querySelector('li blockquote p')!.textContent = 'q, edited'
    expect(saved()).toBe('- a, edited\n  > q, edited\n- b')
  })

  it('writes a quote the engine put in an item at the item’s content column', () => {
    expect(
      editedSurface('<ol start="9"><li><p>a</p><blockquote><p>q</p></blockquote></li></ol>').saved()
    ).toBe('9. a\n   > q')
  })

  it('keeps two quotes the engine put side by side in an item apart', () => {
    // With no blank line between them the two would be read back as one quote.
    expect(
      editedSurface(
        '<ul><li><p>a</p><blockquote><p>q1</p></blockquote><blockquote><p>q2</p></blockquote></li></ul>'
      ).saved()
    ).toBe('- a\n  > q1\n\n  > q2')
  })
})
