// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { editedSurface, openedSurface, savedUntouched } from './rich-markdown-round-trip.test-support'

// Review, 2026-09-30: three CommonMark constructs the editor did not know were rewritten on save.
// A setext heading, 'Title\n=====\n\ntext', became a paragraph with its underline in it and saved
// as 'Title =====\n\ntext'. An indented code block, 'text\n\n    code line\n\nafter', lost its
// indent and saved as a paragraph, 'text\n\ncode line\n\nafter'. A list item's second paragraph,
// '- a\n\n  para\n- b', left the list and split it in two: '- a\n\npara\n\n- b'.
describe('a setext heading', () => {
  it.each([
    ['a level-1 heading', 'Title\n=====\n\ntext'],
    ['a level-2 heading', 'Title\n---\n\ntext'],
    ['a one-character underline', 'Title\n-'],
    ['an underline three columns in', 'Title\n   ==='],
    ['a heading under a paragraph', 'para\n\nTitle\n-----'],
    ['a heading whose words hold a pipe', 'a | b\n---']
  ])('saves %s back as written', (_name, markdown) => {
    expect(savedUntouched(markdown)).toBe(markdown)
  })

  it('draws the underline as the heading it makes, not as a rule or front matter', () => {
    const { editor } = openedSurface('Title\n---')
    expect(editor.querySelector('h2')?.textContent).toBe('Title')
    expect(editor.querySelector('hr, [contenteditable="false"]')).toBeNull()
    expect(openedSurface('Title\n=====').editor.querySelector('h1')?.textContent).toBe('Title')
  })

  it('keeps its underline when its words are edited', () => {
    const { editor, saved } = openedSurface('Title\n=====\n\ntext')
    editor.querySelector('h1')!.textContent = 'New title'
    expect(saved()).toBe('New title\n=====\n\ntext')
  })

  it('is written with hashes once it is a level an underline cannot write', () => {
    expect(editedSurface('<h3 data-md-setext="===">Title</h3>').saved()).toBe('### Title')
    expect(editedSurface('<h2 data-md-setext="===">Title</h2>').saved()).toBe('## Title')
  })

  it('is written with hashes once its words would read as another block', () => {
    expect(editedSurface('<h1 data-md-setext="===">- item</h1>').saved()).toBe('# - item')
  })

  it('joins a heading written over two lines onto one, which reads the same', () => {
    expect(savedUntouched('one\ntwo\n===')).toBe('one two\n===')
  })

  it('drops the spaces after an underline, which say nothing', () => {
    expect(savedUntouched('Title\n===  \n\ntext')).toBe('Title\n===\n\ntext')
  })

  it('still reads a spaced rule under a paragraph as a rule', () => {
    expect(savedUntouched('a\n- - -\nb')).toBe('a\n\n---\n\nb')
  })
})

describe('an indented code block', () => {
  it.each([
    ['one line between paragraphs', 'text\n\n    code line\n\nafter'],
    ['lines, a blank line and deeper indent', 'text\n\n    if x:\n        y()\n\n    z()'],
    ['a document that opens with code', '    code'],
    ['markdown in the code', 'text\n\n    # not a heading\n    - not a list\n    **not bold** &amp;']
  ])('saves %s back as written', (_name, markdown) => {
    const { editor, saved } = openedSurface(markdown)
    expect(editor.querySelector('pre')).not.toBeNull()
    expect(saved()).toBe(markdown)
  })

  it('reads an indented line right under a heading as code, with the blank line every block gets', () => {
    const { editor, saved } = openedSurface('# T\n    code')
    expect(editor.querySelector('pre')?.textContent).toBe('code')
    expect(saved()).toBe('# T\n\n    code')
  })

  it('reads an indented line right under a paragraph as the paragraph’s, not code', () => {
    const { editor, saved } = openedSurface('para\n    more')
    expect(editor.querySelector('pre')).toBeNull()
    expect(saved()).toBe('para more')
  })

  it('still reads an indented rule as a rule', () => {
    expect(savedUntouched('    ---')).toBe('---')
  })

  it('keeps its indent when its code is edited', () => {
    const { editor, saved } = openedSurface('text\n\n    one\n\nafter')
    editor.querySelector('code')!.textContent = 'one\ntwo'
    expect(saved()).toBe('text\n\n    one\n    two\n\nafter')
  })

  it('is fenced once its code starts or ends blank, which an indent cannot write', () => {
    const { editor, saved } = openedSurface('text\n\n    one')
    editor.querySelector('code')!.textContent = '\none'
    expect(saved()).toBe('text\n\n```\n\none\n```')
  })

  it('is fenced once it follows a list, where an indent would put it in the last item', () => {
    const { editor, saved } = openedSurface('- a\n\npara\n\n    code')
    editor.querySelector(':scope > p')!.remove()
    expect(saved()).toBe('- a\n\n```\ncode\n```')
  })
})

describe('a list item that holds more than one paragraph', () => {
  it.each([
    ['a second paragraph', '- a\n\n  para\n- b'],
    ['a second paragraph under `1. `', '1. a\n\n   para\n2. b'],
    ['a second paragraph four columns in', '1. a\n\n    para\n2. b'],
    ['three paragraphs', '- a\n\n  b\n\n  c'],
    ['a paragraph after a fence, with no blank line', '- a\n  ```\n  x\n  ```\n  more'],
    ['a paragraph after a nested list', '- a\n  - b\n\n  para\n- c'],
    ['an indented code block in the item', '- a\n\n      code\n- b'],
    ['a second paragraph in a task', '- [ ] a\n\n  para']
  ])('saves %s back as written', (_name, markdown) => {
    expect(savedUntouched(markdown)).toBe(markdown)
  })

  it('draws the second paragraph inside its item', () => {
    const { editor } = openedSurface('- a\n\n  para\n- b')
    const items = editor.querySelectorAll('ul > li')
    expect(items).toHaveLength(2)
    expect(Array.from(items[0]!.querySelectorAll('p')).map((p) => p.textContent)).toEqual([
      'a',
      'para'
    ])
  })

  it('joins a wrapped second paragraph onto one line, as the item’s words are', () => {
    expect(savedUntouched('- a\n\n  one\n  two\n- b')).toBe('- a\n\n  one two\n- b')
  })

  it('keeps a paragraph written left of the item’s words out of the item', () => {
    expect(savedUntouched('1. a\n\n  para')).toBe('1. a\n\npara')
  })

  it('writes a paragraph the engine put in an item at the item’s content column', () => {
    expect(editedSurface('<ol start="10"><li><p>a</p><p>b</p></li></ol>').saved()).toBe(
      '10. a\n\n    b'
    )
  })

  it('keeps each paragraph when one is edited', () => {
    const { editor, saved } = openedSurface('- a\n\n  para\n- b')
    editor.querySelectorAll('li > p')[1]!.textContent = 'para, edited'
    expect(saved()).toBe('- a\n\n  para, edited\n- b')
  })
})
