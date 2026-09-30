import { describe, expect, it } from 'vitest'
import { parseMobileMarkdown } from './mobile-markdown-parser'

// Review, 2026-09-30: a fence inside a `>` quote stayed in the quote's TEXT as
// raw source, so the inline matcher read ```` ``` ```` as a code span running
// across lines and `~~` as strikethrough. The quote drew `~\na\n~` for a tilde
// fence, `sh` as a word for a fence's language, the fence's own backticks for
// an unclosed one, and every stray newline in between; the Copy, which is
// built to match the screen, copied the same. The fence has to come out of
// the quote as a block of its own, as it does out of a list item
// (mobile-markdown-list-fence.test.ts), and the quote's bar runs down beside
// it.
describe('a fenced code block written inside a quote', () => {
  it('comes out as a code block of its own, not as quote text', () => {
    expect(parseMobileMarkdown(['> ```', '> x = 1', '> ```'].join('\n'))).toEqual([
      { type: 'code', text: 'x = 1', language: undefined, closed: true, quoted: true }
    ])
  })

  it('cuts the quote around it, with the language on the code and never in the words', () => {
    const blocks = parseMobileMarkdown(
      ['> intro', '>', '> ```sh', '> ls *.ts', '> ```', '>', '> outro'].join('\n')
    )
    expect(blocks).toEqual([
      { type: 'quote', text: 'intro' },
      { type: 'code', text: 'ls *.ts', language: 'sh', closed: true, quoted: true, continuesQuote: true },
      { type: 'quote', text: 'outro', continuesQuote: true }
    ])
  })

  it('runs an unclosed fence to the end of the quote, as code still streaming in', () => {
    expect(parseMobileMarkdown(['> ```', '> unclosed `x`'].join('\n'))).toEqual([
      { type: 'code', text: 'unclosed `x`', language: undefined, closed: false, quoted: true }
    ])
    // The line after the quote ends it, and is not code.
    expect(parseMobileMarkdown(['> ```', '> a', 'b'].join('\n'))).toEqual([
      { type: 'code', text: 'a', language: undefined, closed: false, quoted: true },
      { type: 'paragraph', text: 'b' }
    ])
  })

  it('draws a quoted fence under a list item after the item, as code', () => {
    const blocks = parseMobileMarkdown(['- item', '  > ```', '  > <b>x</b>', '  > ```'].join('\n'))
    expect(blocks.map((block) => block.type)).toEqual(['list', 'code'])
    expect(blocks[0]).toMatchObject({ type: 'list', items: [{ text: 'item', depth: 0 }] })
    expect(blocks[1]).toEqual({ type: 'code', text: '<b>x</b>', language: undefined, closed: true, quoted: true })
  })

  it('takes a fence out of a quote inside a quote the same way', () => {
    expect(parseMobileMarkdown(['> > ```', '> > x', '> > ```'].join('\n'))).toEqual([
      { type: 'code', text: 'x', language: undefined, closed: true, quoted: true }
    ])
  })

  it('keeps the inner quote’s marker on its words when the fence comes out of it', () => {
    const blocks = parseMobileMarkdown(
      ['> a', '>', '> > b', '> >', '> > ```', '> > x', '> > ```', '>', '> c'].join('\n')
    )
    expect(blocks).toEqual([
      { type: 'quote', text: 'a\n\n> b' },
      { type: 'code', text: 'x', language: undefined, closed: true, quoted: true, continuesQuote: true },
      { type: 'quote', text: 'c', continuesQuote: true }
    ])
  })

  it('leaves a quote inside a quote with no fence drawn as it was, marker and all', () => {
    expect(parseMobileMarkdown(['> a', '>', '> > b', '>', '> c'].join('\n'))).toEqual([
      { type: 'quote', text: 'a\n\n> b\n\nc' }
    ])
    // Two paragraphs of the inner quote keep the blank `>` line between them.
    expect(parseMobileMarkdown(['> > b1', '> >', '> > b2'].join('\n'))).toEqual([
      { type: 'quote', text: '> b1\n>\n> b2' }
    ])
    // Its words fill the width, as the outer quote's always have; its source
    // lines used to be drawn as they were wrapped.
    expect(parseMobileMarkdown(['> > inner', '> > more'].join('\n'))).toEqual([
      { type: 'quote', text: '> inner more' }
    ])
  })

  it('keeps two quotes a blank line apart as two, so their bars do not join', () => {
    expect(parseMobileMarkdown(['> a', '', '> ```', '> x', '> ```'].join('\n'))).toEqual([
      { type: 'quote', text: 'a' },
      { type: 'code', text: 'x', language: undefined, closed: true, quoted: true }
    ])
  })

  it('routes a quoted mermaid fence as mermaid', () => {
    expect(parseMobileMarkdown(['> ```mermaid', '> graph TD', '> ```'].join('\n'))).toEqual([
      { type: 'code', text: 'graph TD', language: 'mermaid', closed: true, quoted: true }
    ])
  })

  it('reads an indented code block inside a quote as code too', () => {
    expect(parseMobileMarkdown(['>     indented code', '>     more'].join('\n'))).toEqual([
      { type: 'code', text: 'indented code\nmore', language: undefined, closed: true, quoted: true }
    ])
  })

  describe('at the degenerate sizes', () => {
    it('reads an empty quoted fence as an empty code block, never as backticks', () => {
      expect(parseMobileMarkdown(['> ```', '> ```'].join('\n'))).toEqual([
        { type: 'code', text: '', language: undefined, closed: true, quoted: true }
      ])
    })

    it('reads a quote that is only an opener as a fence that has not closed', () => {
      expect(parseMobileMarkdown('> ```')).toEqual([
        { type: 'code', text: '', language: undefined, closed: false, quoted: true }
      ])
    })

    it('leaves a one-line prose quote one quote block, as it was', () => {
      expect(parseMobileMarkdown('> quoted **text**')).toEqual([{ type: 'quote', text: 'quoted **text**' }])
    })

    it('leaves an empty quote the empty quote block it was', () => {
      expect(parseMobileMarkdown('>')).toEqual([{ type: 'quote', text: '' }])
    })
  })
})
