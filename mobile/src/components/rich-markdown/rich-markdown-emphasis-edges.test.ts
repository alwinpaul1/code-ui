// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { editedSurface, openedSurface } from './rich-markdown-round-trip.test-support'

// Review, 2026-09-30: bold, italic and strike were written as their marks around the raw text of
// the element, so a mark whose selection took a space in, which a double-tap or a drag often does,
// was saved as invalid markdown: <p>a <strong>word </strong>next</p> as 'a **word **next', which
// the desktop, the chat and the phone's own reload show with literal stars. A mark left empty was
// saved as '****', which alone on a line is a rule. Spaces now go outside the marks, and a mark
// with no words writes nothing.
describe('bold, italic or strike with a space at its edge, or empty', () => {
  it.each([
    ['a bold word with a space after it', '<p>a <strong>word </strong>next</p>', 'a **word** next'],
    ['an italic word with a space before it', '<p>a<em> word</em> next</p>', 'a *word* next'],
    ['a struck word with spaces around it', '<p>a <s> gone </s>b</p>', 'a  ~~gone~~ b'],
    ['nested marks with a trailing space', '<p>a <strong><em>x </em></strong>b</p>', 'a ***x*** b'],
    ['a mark holding only a space', '<p>a<strong> </strong>b</p>', 'a b'],
    ['a mark at the end with a space in it', '<p>a <em>b </em></p>', 'a *b*'],
    ['a mark ending in the engine’s break', '<p><strong>a<br></strong></p>', '**a**'],
    ['a mark in a list item', '<ul><li><p>a <strong>b </strong>c</p></li></ul>', '- a **b** c'],
    ['a mark in a heading', '<h2><em> title</em></h2>', '## *title*'],
    [
      'a mark in a table cell',
      '<table><thead><tr><th><strong>h </strong></th></tr></thead><tbody><tr><td>x</td></tr></tbody></table>',
      '| **h** |\n| --- |\n| x |'
    ]
  ])('saves %s with the space outside the marks', (_name, markup, markdown) => {
    expect(editedSurface(markup).saved()).toBe(markdown)
  })

  it('writes nothing for an empty mark, and drops the paragraph it leaves empty', () => {
    expect(editedSurface('<p>a</p><p><strong></strong></p><p>b</p>').saved()).toBe('a\n\nb')
    expect(editedSurface('<p>a<em></em>b</p>').saved()).toBe('ab')
    expect(editedSurface('<p><s><strong></strong></s></p>').saved()).toBe('')
  })

  it('saves marks that read back as the same marks', () => {
    const saved = editedSurface('<p>a <strong>word </strong>next and<em> it</em></p>').saved()
    const { editor, saved: again } = openedSurface(saved)
    expect(editor.querySelector('strong')?.textContent).toBe('word')
    expect(editor.querySelector('em')?.textContent).toBe('it')
    expect(again()).toBe(saved)
  })

  it('leaves a mark with no space at its edges as it was', () => {
    expect(editedSurface('<p>a <strong>b</strong> <em>c</em> <s>d</s></p>').saved()).toBe(
      'a **b** *c* ~~d~~'
    )
  })
})
