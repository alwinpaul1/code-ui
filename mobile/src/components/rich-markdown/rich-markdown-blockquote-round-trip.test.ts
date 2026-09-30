// @vitest-environment happy-dom
import { marked } from 'marked'
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

/** marked's reading of a document (the desktop's), whitespace aside. */
const reading = (source: string) =>
  marked.parse(source, { async: false }).replace(/\s+/g, ' ').replace(/> </g, '><').trim()

// Sweep, 2026-10-01, after the lazy line under a quote's table: the quote reader took a line four
// columns in under a heading or a rule for more words, since it counts those as a paragraph a lazy
// line may join, and then joined a lazy line to that code: '> # h\n>     code\nbody' saved
// '> # h\n>     code\n> body', which marked reads with `body` inside the quote. marked reads the
// line as code, and a lazy line after code is no quote's, as 0bf636a3 saved it.
describe('a lazy line under a quote whose last line is code', () => {
  it.each([
    ['a heading', '> # h\n>     code\nbody', '> # h\n>     code\n\nbody'],
    ['a rule', '> ---\n>     code\nbody', '> ---\n>     code\n\nbody'],
    ['a rule after words', '> a\n> ***\n>     code\nbody', '> a\n> ***\n>     code\n\nbody'],
    ['an underlined heading', '> a\n> ---\n>     code\nbody', '> a\n> ---\n>     code\n\nbody'],
    ['a heading underlined with `=`', '> a\n> ===\n>     code\nbody', '> a\n> ===\n>     code\n\nbody']
  ])('ends the quote above the line after code under %s', (_name, markdown, saved) => {
    expect(savedUntouched(markdown)).toBe(saved)
    expect(reading(saved)).toBe(reading(markdown))
  })

  it.each([
    ['words four columns in under words', '> a\n>     b\nbody', '> a\n>     b\n> body'],
    ['an item’s words four columns in', '> - a\n>     b\nbody', '> - a\n>     b\n> body'],
    ['words after a heading and its code', '> # h\n>     code\n> text\nbody', '> # h\n>     code\n> text\n> body'],
    ['words four columns in under a heading’s words', '> # h\n> text\n>     more\nbody', '> # h\n> text\n>     more\n> body']
  ])('keeps the line after %s in the quote', (_name, markdown, saved) => {
    expect(savedUntouched(markdown)).toBe(saved)
    expect(reading(saved)).toBe(reading(markdown))
  })
})

// Review of the lazy line under a quote's table, 2026-10-01: a table the quote's own lines made
// right under a quote nested in it is that nested quote's to marked, which takes those lines for
// its own lazy ones, and so is a lazy line after it: '> > q\n> | a |\n> | - |\nbody' is one row
// holding `body` inside the nested quote. The first fix read the table as the outer quote's and
// saved `body` as a paragraph of its own.
describe('a lazy line after a table right under a nested quote', () => {
  it.each([
    ['a table the nested quote takes', '> > q\n> | a |\n> | - |\nbody', '> > q\n> | a |\n> | - |\n> body'],
    [
      'a nested quote’s table header',
      '> > | - |\n> | - |\n> | - |\n| 1 | 2 |',
      '> > | - |\n> | - |\n> | - |\n> | 1 | 2 |'
    ]
  ])('keeps the line after %s where it was', (_name, markdown, saved) => {
    expect(savedUntouched(markdown)).toBe(saved)
    expect(reading(saved)).toBe(reading(markdown))
  })

  it.each([
    ['a blank line', '> > q\n>\n> | a |\n> | - |\nbody', '> > q\n>\n> | a |\n> | - |\n>\n> body'],
    ['a heading', '> > q\n> # h\n> | a |\n> | - |\nbody', '> > q\n> # h\n> | a |\n> | - |\n>\n> body']
  ])('keeps a lazy line a paragraph of the quote after a table %s put back in it', (_name, markdown, saved) => {
    expect(savedUntouched(markdown)).toBe(saved)
    expect(reading(saved)).toBe(reading(markdown))
  })
})
