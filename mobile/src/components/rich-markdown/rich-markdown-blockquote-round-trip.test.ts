// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { editedSurface, openedSurface, savedUntouched } from './rich-markdown-round-trip.test-support'

// Review, 2026-09-30: a quote was saved as its inline text, trimmed, with `> ` before each line.
// Enter inside a quote makes a second `<p>` or `<div>` in it, and the blocks were joined with
// nothing between them: <blockquote><p>first line</p><p>second line</p></blockquote> saved as
// '> first linesecond line'. A blank quote line loaded as two breaks and saved as '> ' with a
// trailing space. A quote's blocks are now blocks, separated by a bare '>' line.
describe('a quote that holds more than one block', () => {
  it('keeps the paragraphs Enter made inside a quote apart', () => {
    expect(
      editedSurface('<blockquote><p>first line</p><p>second line</p></blockquote>').saved()
    ).toBe('> first line\n>\n> second line')
  })

  it('reads a blank quote line as a paragraph break and saves it as a bare >', () => {
    const { editor, saved } = openedSurface('> a\n>\n> b')
    expect(editor.querySelectorAll('blockquote > p')).toHaveLength(2)
    expect(saved()).toBe('> a\n>\n> b')
    expect(savedUntouched('> a\n> \n> b')).toBe('> a\n>\n> b')
  })

  it.each([
    ['a paragraph and a div', '<blockquote><p>a</p><div>b</div></blockquote>', '> a\n>\n> b'],
    [
      'a list',
      '<blockquote><p>a</p><ul><li><p>b</p></li><li><p>c</p></li></ul></blockquote>',
      '> a\n>\n> - b\n> - c'
    ],
    [
      'a code block with a blank line',
      '<blockquote><p>a</p><pre data-language="sh"><code>ls\n\necho</code></pre></blockquote>',
      '> a\n>\n> ```sh\n> ls\n>\n> echo\n> ```'
    ],
    ['a quote', '<blockquote><p>a</p><blockquote><p>b</p></blockquote></blockquote>', '> a\n>\n> > b'],
    ['text the engine left bare', '<blockquote>quoted<br></blockquote>', '> quoted'],
    ['text beside a paragraph', '<blockquote>bare<p>para</p></blockquote>', '> bare\n>\n> para'],
    ['an empty paragraph between two', '<blockquote><p>a</p><p><br></p><p>b</p></blockquote>', '> a\n>\n> b']
  ])('saves a quote holding %s as its blocks', (_name, markup, markdown) => {
    expect(editedSurface(markup).saved()).toBe(markdown)
  })

  it.each([
    ['one line', '> Quoted line'],
    ['wrapped lines', '> first\n> second'],
    ['a hard break of two spaces', '> a  \n> b'],
    ['a hard break of a backslash', '> a\\\n> b'],
    ['three paragraphs', '> a\n>\n> b\n>\n> c'],
    ['a nested quote written as text', '> > a'],
    ['an empty quote', '>']
  ])('saves a quote of %s back as written', (_name, markdown) => {
    expect(savedUntouched(markdown)).toBe(markdown)
  })

  it('drops a blank quote line at either end, which holds nothing', () => {
    expect(savedUntouched('>\n> a\n>')).toBe('> a')
  })

  it('keeps the other paragraph when one is typed into', () => {
    const { editor, saved } = openedSurface('> a\n>\n> b')
    editor.querySelectorAll('blockquote > p')[1]!.textContent = 'b, edited'
    expect(saved()).toBe('> a\n>\n> b, edited')
  })
})
