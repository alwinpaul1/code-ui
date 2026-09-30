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

  // Review, 2026-09-30, the mirror image: an italic could hold no star, so
  // `***x** y*` copied as "*x y*" (the screen is pinned in
  // MobileMarkdown.nested-emphasis.test.tsx).
  it('copies an italic holding bold without stray stars or underscores', () => {
    expect(markdownPlainText('***x** y*')).toBe('x y')
    expect(markdownPlainText('*a **b** c*')).toBe('a b c')
    expect(markdownPlainText('*x **y** z **w** v*')).toBe('x y z w v')
    expect(markdownPlainText('___x__ y_')).toBe('x y')
    expect(markdownPlainText('_a __b__ c_')).toBe('a b c')
    expect(markdownPlainText('*one **b** two* and ***x** y*')).toBe('one b two and x y')
  })

  it('keeps an underscore italic holding bold literal inside a word', () => {
    expect(markdownPlainText('snake_a __b__ c_case')).toBe('snake_a b c_case')
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

  // Review, 2026-09-30: the HTML pass protected only a one-backtick span on
  // one line, so a tag in a span across a soft line break, or in a
  // two-backtick span holding a backtick, was rewritten to `**x**` before
  // the screen drew the span. The screen is pinned in
  // MobileMarkdown.code-protection.test.tsx.
  it('copies a code span across a line break with its tags as written', () => {
    expect(markdownPlainText('a `<b>x\ny</b>` b')).toBe('a <b>x y</b> b')
    expect(markdownPlainText('- a `<b>x\n  y</b>` b')).toBe('• a <b>x y</b> b')
    expect(markdownPlainText('> a `<b>x\n> y</b>` b')).toBe('a <b>x y</b> b')
    expect(markdownPlainText('a ``x`<b>y\nz</b>`` b')).toBe('a x`<b>y z</b> b')
  })

  it('copies a two-backtick span holding a backtick with its tags as written', () => {
    expect(markdownPlainText('a ``x`b <b>y</b>`` c')).toBe('a x`b <b>y</b> c')
    expect(markdownPlainText('use ``&amp;`` here')).toBe('use &amp; here')
  })

  it('reads no code span across a blank line, a heading or a new list item', () => {
    expect(markdownPlainText('a `x <b>y</b>\n\nz` b')).toBe('a `x y\n\nz` b')
    expect(markdownPlainText('# a `x\n<b>y</b>` b')).toBe('a `x\n\ny` b')
    expect(markdownPlainText('- a `x\n- <b>y</b>` b')).toBe('• a `x\n• y` b')
  })

  it('reads an escaped backtick as no code span, so its tags are HTML', () => {
    expect(markdownPlainText('a \\`<b>x</b>` b')).toBe('a `x` b')
    expect(markdownPlainText('a \\\\`<b>x</b>` b')).toBe('a \\<b>x</b> b')
  })

  it('copies a code block as its code, without the fences or the language', () => {
    expect(markdownPlainText('Run:\n\n```bash\nnpm test\nnpm run lint\n```\n\nThen push.')).toBe(
      'Run:\n\nnpm test\nnpm run lint\n\nThen push.'
    )
  })

  // Review, 2026-09-30: the document was trimmed before the HTML pass saw it,
  // which took the first line's indent too, so a reply that opens with an
  // indented code block read as HTML prose: `<div>x</div>` drew and copied as
  // `x`, and `&amp;` as `&`. The same block after a paragraph was code.
  it("copies an indented code block on the reply's first line verbatim", () => {
    expect(markdownPlainText('    <div>x</div>\n    &amp; y')).toBe('<div>x</div>\n&amp; y')
    expect(markdownPlainText('\t<b>x</b> &amp; y')).toBe('<b>x</b> &amp; y')
    expect(markdownPlainText('\n\n    <b>x</b>\n\nafter')).toBe('<b>x</b>\n\nafter')
    expect(markdownPlainText('\r\n    <b>x</b>\r\n')).toBe('<b>x</b>')
  })

  // Review, 2026-09-30: where marked had closed a list or a quote, the code
  // ranges still thought it open, so an indented block after it went through
  // the HTML pass and `<b>x</b>` copied as `**x**`. The ranges are pinned in
  // markdown-code-ranges.test.ts, the screen in
  // MobileMarkdown.code-protection.test.tsx.
  it('copies an indented block after a heading that ended a list verbatim', () => {
    expect(markdownPlainText('- item\n# Next\n\n    <b>x</b>')).toBe('• item\n\nNext\n\n<b>x</b>')
    expect(markdownPlainText('text\n# Next\n\n    <b>x</b>')).toBe('text\n\nNext\n\n<b>x</b>')
    expect(markdownPlainText('- item\n#hashtag\n\n    <b>x</b>')).toBe('• item\n\n#hashtag\n\n<b>x</b>')
    expect(markdownPlainText('- # H\n        <b>x</b>')).toBe('H\n\n  <b>x</b>')
  })

  it('copies an indented block after a quote that ends in no paragraph verbatim', () => {
    expect(markdownPlainText('> ```\n> x\n> ```\n    <b>x</b>')).toBe('x\n\n<b>x</b>')
    expect(markdownPlainText('> # H\n    <b>x</b>')).toBe('# H\n\n<b>x</b>')
    expect(markdownPlainText('>\n    <b>x</b>')).toBe('<b>x</b>')
  })

  it('still copies a lazy line of a quote\'s paragraph as that paragraph', () => {
    expect(markdownPlainText('> quoted text\n    <b>x</b>')).toBe('quoted text x')
    expect(markdownPlainText('> quote\n    <b>1</b>\n>     <b>2</b>')).toBe('quote 1 2')
    expect(markdownPlainText('- item\n<div>\n\n    <b>x</b>')).toBe('• item\nx')
  })

  it('copies a one-line indented block, and nothing for lines of only spaces', () => {
    expect(markdownPlainText('    <b>x</b>')).toBe('<b>x</b>')
    expect(markdownPlainText('    ')).toBe('')
    expect(markdownPlainText('\n    \n\t\n')).toBe('')
  })

  it('still reads a first line indented less than four columns, or after a byte-order mark, as prose', () => {
    expect(markdownPlainText('   <b>x</b> y')).toBe('x y')
    expect(markdownPlainText('﻿# Title\n\ntext')).toBe('Title\n\ntext')
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

  // Review, 2026-09-30: the HTML pass rewrote the code of a fence inside a
  // quote, so the Copy held "**x** &" for `<b>x</b> &amp;`.
  it('copies the code of a fence inside a quote as written', () => {
    expect(markdownPlainText('> ```\n> <b>x</b> &amp;\n> ```')).toBe('<b>x</b> &amp;')
    expect(markdownPlainText('> ```tsx\n> <Text>a</Text>\n> ```')).toBe('<Text>a</Text>')
    expect(markdownPlainText('> > ```\n> > <b>x</b>\n> > ```')).toBe('<b>x</b>')
  })

  // Review, 2026-09-30, the same day: a fence inside a quote was still the
  // quote's TEXT, so the inline pass read its backticks as a code span across
  // lines and its tildes as strikethrough. The Copy is built to match the
  // screen, and both held the fence's marks, its language and a stray newline
  // at each end. The fence is now a code block of its own
  // (mobile-markdown-quote-fence.test.ts), and it copies as one.
  it('copies a quoted fence as its code, with no fence marks or stray newlines', () => {
    expect(markdownPlainText('> ```\n> x = 1\n> ```')).toBe('x = 1')
    expect(markdownPlainText('> ~~~\n> a\n> ~~~')).toBe('a')
  })

  it('copies the prose around a quoted fence without its language tag or extra blank lines', () => {
    expect(markdownPlainText('> intro\n>\n> ```sh\n> ls *.ts\n> ```\n>\n> outro')).toBe(
      'intro\n\nls *.ts\n\noutro'
    )
    expect(markdownPlainText('> a\n>\n> > ```\n> > x\n> > ```\n>\n> c')).toBe('a\n\nx\n\nc')
  })

  it('copies an unclosed quoted fence as code to the end of the quote, backticks inside it kept', () => {
    expect(markdownPlainText('> ```\n> unclosed `x`')).toBe('unclosed `x`')
  })

  it('keeps the emphasis marks inside a quoted tilde fence', () => {
    expect(markdownPlainText('> ~~~\n> git commit -m "**wip**" *.ts\n> ~~~')).toBe('git commit -m "**wip**" *.ts')
    expect(markdownPlainText('> ```\n> git commit -m "**wip**" *.ts\n> ```')).toBe('git commit -m "**wip**" *.ts')
  })

  it('copies a quoted fence as written and the prose after the quote without its tags', () => {
    expect(markdownPlainText('> ```\n> <b>x</b>\n> ```\n\nafter <b>y</b>')).toBe('<b>x</b>\n\nafter y')
  })

  it('copies a quoted fence under a list item after the item, as code', () => {
    expect(markdownPlainText('- item\n  > ```\n  > <b>x</b>\n  > ```')).toBe('• item\n\n<b>x</b>')
  })

  it('copies an empty quoted fence, or one that has only opened, as nothing', () => {
    expect(markdownPlainText('> ```\n> ```')).toBe('')
    expect(markdownPlainText('> ```')).toBe('')
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

  // Review, 2026-09-30: an address was cut at its first `)` and a label at
  // its first `]`, so the Copy of these held a stray bracket, a cut address,
  // or a badge's `![`, `](` and image address. The screen is pinned in
  // MobileMarkdown.link-shapes.test.ts.
  it('copies an address with parentheses in it whole, with nothing after it', () => {
    expect(markdownPlainText('[https://x.dev/a_(b)](https://x.dev/a_(b))')).toBe('https://x.dev/a_(b)')
    expect(markdownPlainText('see [notes](docs/a_(b).md) now')).toBe('see notes now')
    expect(markdownPlainText('[w](https://x.dev/a_((b)c)) ok')).toBe('w (https://x.dev/a_((b)c)) ok')
  })

  it('copies a README badge as its words and the address it links to, with no brackets', () => {
    expect(markdownPlainText('[![CI](https://img.shields.io/b.svg)](https://github.com/x/y)')).toBe(
      'CI (https://github.com/x/y)'
    )
    expect(markdownPlainText('[![CI](https://a.dev/ci.svg)](https://x.dev/ci) [![npm](https://a.dev/n.svg)](https://x.dev/n)')).toBe(
      'CI (https://x.dev/ci) npm (https://x.dev/n)'
    )
    expect(markdownPlainText('[![](https://a.dev/b.svg)](https://x.dev/y)')).toBe('image (https://x.dev/y)')
  })

  it('copies a badge whose link never closes as the image it still is', () => {
    expect(markdownPlainText('[![CI](https://a.dev/b.svg)] and more')).toBe('[CI (https://a.dev/b.svg)] and more')
  })

  it('copies an address in angle brackets without them', () => {
    expect(markdownPlainText('<https://x.dev/a>,')).toBe('https://x.dev/a,')
    expect(markdownPlainText('<https://x.dev/a.>')).toBe('https://x.dev/a.')
  })

  it('keeps a link whose address or label never closes as written', () => {
    expect(markdownPlainText('[w](docs/a_(b.md')).toBe('[w](docs/a_(b.md')
    expect(markdownPlainText('[w](')).toBe('[w](')
    expect(markdownPlainText('[](x)')).toBe('[](x)')
    expect(markdownPlainText('[x]()')).toBe('[x]()')
  })

  // Review, 2026-09-30: a backslash before punctuation, which makes it
  // literal in CommonMark, was never read: `\*not bold\*` drew italic with
  // both backslashes kept, and `off\!` kept its backslash. The screen is
  // pinned in MobileMarkdown.escapes.test.tsx.
  it('copies an escaped mark as the mark, without its backslash', () => {
    expect(markdownPlainText('\\*not bold\\*')).toBe('*not bold*')
    expect(markdownPlainText('Price 50% off\\!')).toBe('Price 50% off!')
    expect(markdownPlainText('\\_\\_init\\_\\_ and \\~\\~x\\~\\~')).toBe('__init__ and ~~x~~')
    expect(markdownPlainText('\\[not a link](https://x.dev)')).toBe('[not a link](https://x.dev)')
    expect(markdownPlainText('\\`not code`')).toBe('`not code`')
    expect(markdownPlainText('\\<https://x.dev>')).toBe('<https://x.dev>')
  })

  it('reads a mark after an escaped backslash as a mark', () => {
    expect(markdownPlainText('a \\\\ b')).toBe('a \\ b')
    expect(markdownPlainText('\\\\*a*')).toBe('\\a')
    expect(markdownPlainText('\\\\\\*a*')).toBe('\\*a*')
    expect(markdownPlainText('\\**a**')).toBe('*a*')
  })

  it('keeps an escaped mark inside bold, italic and a link\'s words', () => {
    expect(markdownPlainText('**a \\* b**')).toBe('a * b')
    expect(markdownPlainText('*a \\* b*')).toBe('a * b')
    expect(markdownPlainText('[a \\] b](https://x.dev)')).toBe('a ] b (https://x.dev)')
  })

  it('keeps a backslash before anything that is not punctuation', () => {
    expect(markdownPlainText('C:\\Users\\x')).toBe('C:\\Users\\x')
    expect(markdownPlainText('\\')).toBe('\\')
    expect(markdownPlainText('a\\ b')).toBe('a\\ b')
    expect(markdownPlainText('end \\é')).toBe('end \\é')
  })

  it('keeps the backslashes in code and in a link\'s address', () => {
    expect(markdownPlainText('run `a\\*b` and `C:\\\\x`')).toBe('run a\\*b and C:\\\\x')
    expect(markdownPlainText('```\n\\*x\\*\n```')).toBe('\\*x\\*')
    expect(markdownPlainText('[a](docs/a\\_b.md)')).toBe('a')
    expect(markdownPlainText('[a](https://x.dev/a\\_b)')).toBe('a (https://x.dev/a\\_b)')
  })

  it('reads escapes in a heading, a list, a quote, an image\'s words and a table once each', () => {
    expect(markdownPlainText('# \\*h\\*')).toBe('*h*')
    expect(markdownPlainText('- \\*x\\*')).toBe('• *x*')
    expect(markdownPlainText('> \\*q\\*')).toBe('*q*')
    expect(markdownPlainText('![a\\*b](fig/x.png)')).toBe('a*b\nfig/x.png')
    // marked has already read the `\|` in a cell; `\\` is still the cell's.
    expect(markdownPlainText('| h | i |\n| --- | --- |\n| x \\| y | a \\\\\\| b \\*c\\* |')).toBe('h\ti\nx | y\ta \\| b *c*')
  })

  it('leaves an escaped angle bracket or ampersand to the text, not to the HTML cleanup', () => {
    expect(markdownPlainText('\\<b>x\\</b>')).toBe('<b>x</b>')
    // The `</b>` is still a tag, as marked reads it, and is not drawn.
    expect(markdownPlainText('\\<b>x</b> y')).toBe('<b>x y')
    expect(markdownPlainText('\\\\<b>x</b>')).toBe('\\x')
    expect(markdownPlainText('\\&amp; and &amp;')).toBe('&amp; and &')
  })

  it('copies a table as tab-separated rows, marks off each cell', () => {
    expect(markdownPlainText('| Name | Size |\n| --- | --- |\n| `a.ts` | **2 KB** |')).toBe(
      'Name\tSize\na.ts\t2 KB'
    )
  })

  it('copies a link in any column of a table with its address', () => {
    expect(markdownPlainText('| a | b |\n| --- | --- |\n| [x](https://x.dev) | [y](https://y.dev) |')).toBe(
      'a\tb\nx (https://x.dev)\ty (https://y.dev)'
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
// parser's deadline. These take 15 ms or less each on a Mac.
describe('emphasis that never closes', () => {
  it.each([
    ['a bold over many italics', `**${'a *b* '.repeat(15_000)}`],
    ['a bold over many underscore italics', `__${'a _b_ '.repeat(15_000)}`],
    ['a bold opener on every line', '**a *b\n'.repeat(15_000)],
    ['a star after every word', `**${'x*y '.repeat(25_000)}`],
    ['italics joined end to end', `**${'*a*'.repeat(30_000)}`],
    ['a star run', '*'.repeat(100_000)],
    ['an italic over many bolds', `*${'a **b** '.repeat(15_000)}`],
    ['an underscore italic over many bolds', `_${'a __b__ '.repeat(15_000)}`],
    ['an italic opener on every line', '*a **b\n'.repeat(15_000)],
    ['a bold opener after every word in an italic', `*${'**x '.repeat(25_000)}`],
    ['bolds joined end to end in an italic', `*${'**a**'.repeat(30_000)}`],
    ['italic openers before every bold', '* **a** '.repeat(20_000)]
  ])('copies %s inside the deadline', (_name, text) => {
    const copied = runInNewContext('copy(text)', { copy: markdownInlinePlainText, text }, { timeout: 250 })
    expect(typeof copied).toBe('string')
  })
})
