import { describe, expect, it } from 'vitest'
import { parseMobileMarkdown, type MobileMarkdownQuoteMember } from './mobile-markdown-parser'

// A quote holds Markdown of its own since 2026-10-10 (mobile-markdown-quote-blocks.ts):
// its paragraphs, lists and inner quotes are members, drawn inside its bar.
const para = (text: string) => ({ type: 'paragraph', text })
const inner = (...members: MobileMarkdownQuoteMember[]) => ({ type: 'quote', members })
const quoteOf = (members: object[], continuesQuote = false) =>
  continuesQuote ? { type: 'quote', members, continuesQuote: true } : { type: 'quote', members }
const bullets = (...items: object[]) => ({ type: 'list', ordered: false, items })
const bullet = (text: string, depth = 0) => ({ text, depth, ordered: false })

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
      quoteOf([para('intro')]),
      { type: 'code', text: 'ls *.ts', language: 'sh', closed: true, quoted: true, continuesQuote: true },
      quoteOf([para('outro')], true)
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

  it('keeps the inner quote’s words in a quote of their own when the fence comes out of it', () => {
    const blocks = parseMobileMarkdown(
      ['> a', '>', '> > b', '> >', '> > ```', '> > x', '> > ```', '>', '> c'].join('\n')
    )
    expect(blocks).toEqual([
      quoteOf([para('a'), inner(para('b') as MobileMarkdownQuoteMember)]),
      { type: 'code', text: 'x', language: undefined, closed: true, quoted: true, continuesQuote: true },
      quoteOf([para('c')], true)
    ])
  })

  it('draws a quote inside a quote with no fence as a quote of its own inside the bar', () => {
    expect(parseMobileMarkdown(['> a', '>', '> > b', '>', '> c'].join('\n'))).toEqual([
      quoteOf([para('a'), inner(para('b') as MobileMarkdownQuoteMember), para('c')])
    ])
    // Two paragraphs of the inner quote stay two paragraphs.
    expect(parseMobileMarkdown(['> > b1', '> >', '> > b2'].join('\n'))).toEqual([
      quoteOf([inner(para('b1') as MobileMarkdownQuoteMember, para('b2') as MobileMarkdownQuoteMember)])
    ])
    // Inside a quote every newline is a line break (breakProse).
    expect(parseMobileMarkdown(['> > inner', '> > more'].join('\n'))).toEqual([
      quoteOf([inner(para('inner\nmore') as MobileMarkdownQuoteMember)])
    ])
  })

  it('keeps two quotes a blank line apart as two, so their bars do not join', () => {
    expect(parseMobileMarkdown(['> a', '', '> ```', '> x', '> ```'].join('\n'))).toEqual([
      quoteOf([para('a')]),
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
      expect(parseMobileMarkdown('> quoted **text**')).toEqual([quoteOf([para('quoted **text**')])])
    })

    it('leaves an empty quote the empty quote block it was', () => {
      expect(parseMobileMarkdown('>')).toEqual([quoteOf([])])
    })
  })
})

// Decided 2026-10-01: a fence under a list item inside a quote is drawn as
// code, as GitHub and marked both draw it. The quote kept the whole list as
// its raw source, so the fence drew as backticks around words. The fence
// comes out, inside the bar; since 2026-10-10 the list's rows are a list
// inside the bar too, fence or no fence.
describe('a fenced code block under a list item inside a quote', () => {
  const quote = (...lines: string[]) => parseMobileMarkdown(lines.map((line) => `> ${line}`.trimEnd()).join('\n'))

  it('comes out as code inside the quote, after the item', () => {
    expect(quote('- a', '  ```', '  code', '  ```')).toEqual([
      quoteOf([bullets(bullet('a'))]),
      { type: 'code', text: 'code', language: undefined, closed: true, quoted: true, continuesQuote: true }
    ])
  })

  it('keeps a numbered item’s number and the fence’s language, and the item after it', () => {
    expect(quote('1. a', '   ```js', '   x = 1', '   ```', '2. b')).toEqual([
      quoteOf([{ type: 'list', ordered: true, items: [{ text: 'a', depth: 0, ordered: true, number: 1 }] }]),
      { type: 'code', text: 'x = 1', language: 'js', closed: true, quoted: true, continuesQuote: true },
      quoteOf([{ type: 'list', ordered: true, items: [{ text: 'b', depth: 0, ordered: true, number: 2 }] }], true)
    ])
  })

  it('draws the item’s words after the fence at its indent, with no second marker', () => {
    expect(quote('- a', '  ```', '  code', '  ```', '  after', '- b')).toEqual([
      quoteOf([bullets(bullet('a'))]),
      { type: 'code', text: 'code', language: undefined, closed: true, quoted: true, continuesQuote: true },
      quoteOf([bullets({ ...bullet('after'), continuation: true }, bullet('b'))], true)
    ])
  })

  it('takes a fence out of a nested item, and keeps a task’s box', () => {
    expect(quote('- a', '  - b', '    ```', '    c', '    ```')).toEqual([
      quoteOf([bullets(bullet('a'), bullet('b', 1))]),
      { type: 'code', text: 'c', language: undefined, closed: true, quoted: true, continuesQuote: true }
    ])
    expect(quote('- [x] done', '  ```', '  log', '  ```')[0]).toEqual(
      quoteOf([bullets({ ...bullet('done'), checked: true })])
    )
  })

  it('draws a list with no fence in it as a list inside the bar, its lines broken where written', () => {
    expect(quote('- a', '  b', '- c')).toEqual([quoteOf([bullets(bullet('a\nb'), bullet('c'))])])
    expect(quote('- a **x**', '  `code`', '- c')).toEqual([quoteOf([bullets(bullet('a **x**\n`code`'), bullet('c'))])])
  })

  describe('at the degenerate sizes', () => {
    it('reads an item that is only a fence as the fence, with no empty row above it', () => {
      expect(quote('- ```', '  x', '  ```')).toEqual([
        { type: 'code', text: 'x', language: undefined, closed: true, quoted: true }
      ])
    })

    it('reads an empty fence under an item as an empty code block', () => {
      expect(quote('- a', '  ```', '  ```')).toEqual([
        quoteOf([bullets(bullet('a'))]),
        { type: 'code', text: '', language: undefined, closed: true, quoted: true, continuesQuote: true }
      ])
    })
  })
})
