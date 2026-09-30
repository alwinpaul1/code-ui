import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdownBlocks } from './markdown-blocks'

// Review, 2026-09-30: the PR comment reader took any line starting with ```
// for a fence and closed it at the next such line, so a longer fence holding
// a shorter one split into three blocks, a one-line ```npm i``` span opened a
// fence that ran to the end of the comment, ~~~ was never a fence, and a
// fence under a list item was joined into the item's text. And the
// <details>/<blockquote> split ran over the whole text before any line was
// read, so a <details> inside a fence drew as a real collapsible. The rules
// are CommonMark's, read by markdownCodeRanges (markdown-code-ranges.ts), the
// chat's own fence lexer.

const code = (text: string, lang = '') => ({ kind: 'code', text, lang })
const paragraph = (text: string) => ({ kind: 'paragraph', text })

describe('a fence in a PR comment closes only where CommonMark closes it', () => {
  it('keeps a shorter fence inside a longer one as code', () => {
    expect(parseMarkdownBlocks('````md\n```js\nx\n```\n````\nafter')).toEqual([
      code('```js\nx\n```', 'md'),
      paragraph('after')
    ])
  })

  it('reads a one-line ```span``` as inline code, not a fence that eats the comment', () => {
    const blocks = parseMarkdownBlocks('```npm i``` then\n\nnext para')
    expect(blocks).toEqual([paragraph('```npm i``` then'), paragraph('next para')])
    expect(parseInline('```npm i``` then')).toEqual([
      { kind: 'code', text: 'npm i' },
      { kind: 'text', text: ' then' }
    ])
  })

  it('reads ~~~ as a fence, which ``` does not close', () => {
    expect(parseMarkdownBlocks('~~~sh\nls ```\n```\n~~~\nafter')).toEqual([
      code('ls ```\n```', 'sh'),
      paragraph('after')
    ])
  })

  it('closes only on a run of the same mark at least as long, with nothing after it', () => {
    expect(parseMarkdownBlocks('```\na\n~~~\n``\n``` x\n```\nafter')).toEqual([
      code('a\n~~~\n``\n``` x'),
      paragraph('after')
    ])
    expect(parseMarkdownBlocks('```\na\n`````  \nafter')).toEqual([code('a'), paragraph('after')])
  })

  it('takes a fence indented up to three spaces, and that indent off its lines', () => {
    expect(parseMarkdownBlocks('   ```\n   a\n    b\n  c\n   ```')).toEqual([code('a\n b\nc')])
    expect(parseMarkdownBlocks('    ```\n    x\n    ```').some((block) => block.kind === 'code')).toBe(false)
  })

  it('keeps the language that routes a mermaid fence, from backticks or tildes', () => {
    expect(parseMarkdownBlocks('~~~mermaid\ngraph TD\n~~~')).toEqual([code('graph TD', 'mermaid')])
    expect(parseMarkdownBlocks('```Mermaid title="x"\ngraph TD\n```')).toEqual([code('graph TD', 'mermaid')])
  })

  it('reads a fence that is empty, alone, or never closed', () => {
    expect(parseMarkdownBlocks('```')).toEqual([code('')])
    expect(parseMarkdownBlocks('~~~\n~~~')).toEqual([code('')])
    expect(parseMarkdownBlocks('```js\na\n\nb')).toEqual([code('a\n\nb', 'js')])
    expect(parseMarkdownBlocks('```\r\na\r\n```')).toEqual([code('a')])
  })
})

describe('HTML inside a fenced block in a PR comment', () => {
  it('draws a <details> or <blockquote> inside a fence as code', () => {
    expect(parseMarkdownBlocks('```\n<details>\nx\n</details>\n```\nafter')).toEqual([
      code('<details>\nx\n</details>'),
      paragraph('after')
    ])
    expect(parseMarkdownBlocks('```html\n<blockquote>q</blockquote>\n```')).toEqual([
      code('<blockquote>q</blockquote>', 'html')
    ])
  })

  it('keeps a comment and a <br> inside a fence as code', () => {
    expect(parseMarkdownBlocks('```html\n<!-- header -->\n<p>a<br>b</p>\n```')).toEqual([
      code('<!-- header -->\n<p>a<br>b</p>', 'html')
    ])
  })

  it('still opens a real <details> around a fence that mentions its closing tag', () => {
    expect(
      parseMarkdownBlocks('<details><summary>Logs</summary>\n\n```\n</details>\n```\n\n</details>\nafter')
    ).toEqual([
      { kind: 'details', summary: 'Logs', body: [code('</details>')] },
      paragraph('after')
    ])
  })

  it('keeps a <br> and a comment inside inline code, and still reads them outside it', () => {
    expect(parseMarkdownBlocks('Use `<br>` or `<!-- x -->` here<br>next <!-- gone -->line')).toEqual([
      paragraph('Use `<br>` or `<!-- x -->` here\nnext line')
    ])
  })
})

// A comment opened before a fence hides it, as the whole-text regex did: PR
// templates put example fences inside their comments.
describe('a comment around a fence in a PR comment', () => {
  it('still hides a template comment that holds a fence', () => {
    expect(parseMarkdownBlocks('<!--\nExample:\n```\ncode\n```\n-->\nReal text')).toEqual([
      paragraph('Real text')
    ])
  })

  it('reads the fences after a comment that held an unclosed fence', () => {
    expect(parseMarkdownBlocks('<!--\n```\n-->\nafter\n\n```\ncode\n```')).toEqual([
      paragraph('after'),
      code('code')
    ])
  })

  it('keeps the text on either side of a comment that spans lines', () => {
    expect(parseMarkdownBlocks('a <!-- x\n```\ny --> b')).toEqual([paragraph('a  b')])
  })

  it('leaves a comment that never closes as text', () => {
    expect(parseMarkdownBlocks('a <!-- b\n```\nc\n```')).toEqual([paragraph('a <!-- b'), code('c')])
  })
})

describe('a fence under a list item in a PR comment', () => {
  it('draws the fence as code and keeps counting the list after it', () => {
    const md = ['1. Install:', '   ```sh', '   npm i', '   ```', '2. Run it.'].join('\n')
    expect(parseMarkdownBlocks(md)).toEqual([
      { kind: 'list', ordered: true, items: ['Install:'] },
      code('npm i', 'sh'),
      { kind: 'list', ordered: true, items: ['Run it.'], start: 2 }
    ])
  })

  it('keeps counting across the blank lines GitHub comments put around a fence', () => {
    const md = ['1. Install:', '', '   ```sh', '   npm i', '   ```', '', '2. Run:', '', '   ```', '   npm start', '   ```'].join(
      '\n'
    )
    expect(parseMarkdownBlocks(md)).toEqual([
      { kind: 'list', ordered: true, items: ['Install:'] },
      code('npm i', 'sh'),
      { kind: 'list', ordered: true, items: ['Run:'], start: 2 },
      code('npm start')
    ])
  })

  it('keeps counting when every item is numbered 1', () => {
    const md = ['1. a', '   ```', '   x', '   ```', '1. b', '1. c'].join('\n')
    expect(parseMarkdownBlocks(md)).toEqual([
      { kind: 'list', ordered: true, items: ['a'] },
      code('x'),
      { kind: 'list', ordered: true, items: ['b', 'c'], start: 2 }
    ])
  })

  it('reads a fence that opens on the item line itself', () => {
    expect(parseMarkdownBlocks('- ```js\n  x\n  ```\n- next')).toEqual([
      { kind: 'list', ordered: false, items: [''] },
      code('x', 'js'),
      { kind: 'list', ordered: false, items: ['next'] }
    ])
  })

  it('ends a fence where its item ends, and keeps a list that has one item', () => {
    expect(parseMarkdownBlocks('- a\n  ```\n  x\nnot in the item')).toEqual([
      { kind: 'list', ordered: false, items: ['a'] },
      code('x'),
      paragraph('not in the item')
    ])
  })

  it('starts a numbered list at the number its first item carries', () => {
    expect(parseMarkdownBlocks('3. third\n4. fourth')).toEqual([
      { kind: 'list', ordered: true, items: ['third', 'fourth'], start: 3 }
    ])
    expect(parseMarkdownBlocks('0) zero')).toEqual([{ kind: 'list', ordered: true, items: ['zero'], start: 0 }])
    expect(parseMarkdownBlocks('1. one')).toEqual([{ kind: 'list', ordered: true, items: ['one'] }])
  })

  // CommonMark allows nine digits. Past that, parseInt rounds (and 400 digits
  // read Infinity), so the list counts from 1 as it always did rather than
  // draw a number the comment never wrote.
  it('counts from 1 rather than draw a number longer than nine digits', () => {
    for (const number of ['1234567890', '9'.repeat(400)]) {
      expect(parseMarkdownBlocks(`${number}. x`)).toEqual([{ kind: 'list', ordered: true, items: ['x'] }])
    }
    expect(parseMarkdownBlocks('123456789. x')).toEqual([
      { kind: 'list', ordered: true, items: ['x'], start: 123456789 }
    ])
  })
})

describe('a PR comment with many fences and comments', () => {
  it.each([
    ['thousands of fences', '```\nx\n```\n'.repeat(10_000)],
    ['thousands of fences under list items', '- a\n  ```\n  x\n  ```\n'.repeat(5_000)],
    ['thousands of comments that each hold an unclosed fence', '<!--\n```\n-->\n'.repeat(5_000)],
    ['thousands of comments and code spans on one line', '`<!--` <!-- x --> <br>'.repeat(5_000)],
    ['thousands of code spans before one comment', '`a` '.repeat(20_000) + '<!-- x -->'],
    ['a fence run of every length', Array.from({ length: 300 }, (_, n) => '`'.repeat(n + 3)).join('\n')]
  ])('reads %s inside the deadline', (_name, text) => {
    const blocks = runInNewContext('parse(text)', { parse: parseMarkdownBlocks, text }, { timeout: 250 })
    expect(Array.isArray(blocks)).toBe(true)
  })
})
