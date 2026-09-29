import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { markdownInlinePlainText, markdownPlainText } from './markdown-plain-text'

// What a reply's Copy puts on the clipboard (2026-09-28, the user: "Why i
// copy text markdown things come ** ** ''' fix it").

describe('markdownPlainText', () => {
  it('copies nothing for a reply that draws nothing', () => {
    expect(markdownPlainText('')).toBe('')
    expect(markdownPlainText('  \n\n ')).toBe('')
  })

  it('copies a one-word reply as that word', () => {
    expect(markdownPlainText('Done')).toBe('Done')
    expect(markdownPlainText('**Done**')).toBe('Done')
  })

  it('drops the stars, underscores and tildes the screen draws as style', () => {
    expect(markdownPlainText('**bold**, *italic*, __strong__, _em_ and ~~gone~~')).toBe(
      'bold, italic, strong, em and gone'
    )
    expect(markdownPlainText('**Alphabetical `/` menu.**')).toBe('Alphabetical / menu.')
  })

  it('keeps underscores inside a word, which the screen draws as written', () => {
    expect(markdownPlainText('call snake_case_name and foo__bar__baz')).toBe('call snake_case_name and foo__bar__baz')
  })

  // Review, 2026-09-30: Claude writes both of these often, and a bold span
  // could not hold a star, so `***x***` and `**a *b* c**` drew and copied with
  // a literal `*` at each end of the phrase.
  it('copies bold-and-italic, and bold holding italic, without stray stars', () => {
    expect(markdownPlainText('This is ***really important*** and **bold with *em* inside**')).toBe(
      'This is really important and bold with em inside'
    )
    expect(markdownPlainText('***one*** and ***two***')).toBe('one and two')
    expect(markdownPlainText('***lead* then bold**')).toBe('lead then bold')
    expect(markdownPlainText('**a*b*c**')).toBe('abc')
  })

  it('copies the underscore forms of the same nesting without stray underscores', () => {
    expect(markdownPlainText('___x___')).toBe('x')
    expect(markdownPlainText('__a _b_ c__')).toBe('a b c')
  })

  it('keeps the emphasis it already read the way it read it', () => {
    expect(markdownPlainText('**a**')).toBe('a')
    expect(markdownPlainText('*a*')).toBe('a')
    expect(markdownPlainText('__a__')).toBe('a')
    expect(markdownPlainText('_a_')).toBe('a')
    expect(markdownPlainText('**_x_**')).toBe('x')
    expect(markdownPlainText('*__x__*')).toBe('x')
    expect(markdownPlainText('**x**y**z**')).toBe('xyz')
    expect(markdownPlainText('foo___x___bar')).toBe('foo___x___bar')
  })

  it('leaves stars and underscores that close nothing where they are', () => {
    expect(markdownPlainText('an unclosed **a')).toBe('an unclosed **a')
    expect(markdownPlainText('a *** b')).toBe('a *** b')
    // A line of three is a rule, which draws no words.
    expect(markdownPlainText('***')).toBe('')
    // Blanks to fill in: a run followed by a space opens nothing.
    expect(markdownPlainText('Name: *** Date: ***')).toBe('Name: * Date: *')
    expect(markdownPlainText('Name: ___ Date: ___')).toBe('Name: ___ Date: ___')
    // Today's reading, pinned so the nesting change leaves it where it was:
    // the two stars pair as an italic " 3 ", though CommonMark opens nothing
    // on a star with a space after it.
    expect(markdownPlainText('2 * 3 * 4')).toBe('2  3  4')
  })

  it('copies a code pill as its words, backticks and padding off', () => {
    expect(markdownPlainText('only when someone runs `cdk deploy`.')).toBe('only when someone runs cdk deploy.')
    expect(markdownPlainText('`` `user` `` becomes `user`')).toBe('`user` becomes user')
  })

  it('copies a code block as its code, without the fences or the language', () => {
    expect(markdownPlainText('Run:\n\n```bash\nnpm test\nnpm run lint\n```\n\nThen push.')).toBe(
      'Run:\n\nnpm test\nnpm run lint\n\nThen push.'
    )
  })

  it('copies a fence still streaming in without its opener', () => {
    expect(markdownPlainText('```ts\nconst a = 1')).toBe('const a = 1')
  })

  it('drops the hashes off a heading', () => {
    expect(markdownPlainText('# One\n\n## Two\n\n### Three `x`')).toBe('One\n\nTwo\n\nThree x')
  })

  it('copies a quote as its words', () => {
    expect(markdownPlainText('> quoted **text**')).toBe('quoted text')
  })

  it('writes the markers the screen draws for bullets, numbers and tasks', () => {
    expect(markdownPlainText('- one')).toBe('• one')
    expect(markdownPlainText('3. three\n4. four')).toBe('3. three\n4. four')
    expect(markdownPlainText('- [ ] todo\n- [x] done')).toBe('☐ todo\n☑ done')
  })

  it('steps a nested item in, with its level\'s bullet', () => {
    expect(markdownPlainText('- top\n  - child\n    - grandchild')).toBe('• top\n  ◦ child\n    ▪ grandchild')
  })

  it('keeps the rest of an item that a fence cut in two under its words, with no second bullet', () => {
    const copied = markdownPlainText('1. Run this:\n\n   ```\n   make\n   ```\n\n   and wait.\n2. Next')
    expect(copied).not.toContain('```')
    expect(copied).toContain('1. Run this:')
    expect(copied).toContain('make')
    expect(copied).toMatch(/and wait\./)
    expect(copied).not.toMatch(/[•◦▪] and wait/)
  })

  it('keeps a web link\'s address after its words, and a file link as its words', () => {
    expect(markdownPlainText('see [the docs](https://example.com/docs)')).toBe(
      'see the docs (https://example.com/docs)'
    )
    expect(markdownPlainText('[https://x.dev](https://x.dev)')).toBe('https://x.dev')
    expect(markdownPlainText('open [`app.ts:12`](mobile/src/app.ts#L12)')).toBe('open app.ts:12')
  })

  it('leaves sentence punctuation after a bare URL where it was', () => {
    expect(markdownPlainText('go to https://example.com/a.')).toBe('go to https://example.com/a.')
  })

  it('copies an image as its words and address', () => {
    expect(markdownPlainText('![chart](https://x.dev/c.png)')).toBe('chart (https://x.dev/c.png)')
    expect(markdownPlainText('![chart](//x.dev/c.png)')).toBe('chart (//x.dev/c.png)')
  })

  // The chat has no way to load a file beside the reply, so it draws the alt
  // text with the path under it (MobileMarkdownImage's fallback).
  it('keeps the path a file image shows under its words', () => {
    expect(markdownPlainText('Plot:\n\n![fig](fig/plot.svg)')).toBe('Plot:\n\nfig\nfig/plot.svg')
    expect(markdownPlainText('![](fig/plot.svg)')).toBe('fig/plot.svg')
  })

  it('copies an image\'s alt text without its marks, as the screen draws it', () => {
    expect(markdownPlainText('![**fig** `one`](fig/plot.svg)')).toBe('fig one\nfig/plot.svg')
    expect(markdownPlainText('see ![**b** alt](https://x.dev/a.png) here')).toBe('see b alt (https://x.dev/a.png) here')
  })

  it('copies a data: image as its words, never its data', () => {
    const blob = `data:image/png;base64,${'A'.repeat(2000)}`
    expect(markdownPlainText(`![](${blob})`)).toBe('')
    expect(markdownPlainText(`![logo](${blob})`)).toBe('logo')
  })

  it('leaves a link title out of the address it pastes', () => {
    expect(markdownPlainText('[docs](https://x.dev "The docs")')).toBe('docs (https://x.dev)')
    expect(markdownPlainText("[docs](https://x.dev 'The docs')")).toBe('docs (https://x.dev)')
    expect(markdownPlainText('[t](https://x.dev "a \\"b\\" c")')).toBe('t (https://x.dev)')
    expect(markdownPlainText('[a](https://x.dev/a"b")')).toBe('a (https://x.dev/a"b")')
  })

  it('keeps a whole address that has a space in it', () => {
    expect(markdownPlainText('[a](https://x.dev/my file)')).toBe('a (https://x.dev/my file)')
    expect(markdownPlainText('[mail](mailto:a@b.c?subject=Hello World)')).toBe(
      'mail (mailto:a@b.c?subject=Hello World)'
    )
  })

  it('copies a table as tab-separated rows, marks off each cell', () => {
    expect(markdownPlainText('| Name | Size |\n| --- | --- |\n| `a.ts` | **2 KB** |')).toBe(
      'Name\tSize\na.ts\t2 KB'
    )
  })

  it('puts no empty paragraph where a rule was', () => {
    expect(markdownPlainText('above\n\n---\n\nbelow')).toBe('above\n\nbelow')
  })

  it('reads Windows line endings like any other', () => {
    expect(markdownPlainText('**a**\r\n\r\nb')).toBe('a\n\nb')
  })
})

// A bold span may now hold italic spans (markdown-inline-matcher.ts), which
// is a group inside a group; one written with overlapping alternatives takes
// exponential time on a bold that never closes. The screen and the Copy run
// the same pattern over every paragraph of every reply, so it is held to the
// parser's deadline. About 20 ms each for these on a Mac.
describe('emphasis that never closes', () => {
  it.each([
    ['a bold over many italics', `**${'a *b* '.repeat(15_000)}`],
    ['a bold over many underscore italics', `__${'a _b_ '.repeat(15_000)}`],
    ['a bold opener on every line', '**a *b\n'.repeat(15_000)],
    ['a star after every word', `**${'x*y '.repeat(25_000)}`],
    ['italics joined end to end', `**${'*a*'.repeat(30_000)}`],
    ['a star run', '*'.repeat(100_000)]
  ])('copies %s inside the deadline', (_name, text) => {
    const copied = runInNewContext('copy(text)', { copy: markdownInlinePlainText, text }, { timeout: 250 })
    expect(typeof copied).toBe('string')
  })
})
