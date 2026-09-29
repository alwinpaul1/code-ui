import { describe, expect, it } from 'vitest'
import { isMobileMermaidLanguage } from './mobile-mermaid-language'
import { normalizeMobileMarkdownPreviewHtml } from './mobile-markdown-preview-html'
import { parseMobileMarkdown } from './mobile-markdown-parser'

describe('isMobileMermaidLanguage', () => {
  it('matches mermaid case-insensitively after trim', () => {
    expect(isMobileMermaidLanguage('mermaid')).toBe(true)
    expect(isMobileMermaidLanguage('Mermaid')).toBe(true)
    expect(isMobileMermaidLanguage(' MERMAID ')).toBe(true)
  })

  it('rejects non-mermaid languages and missing language', () => {
    expect(isMobileMermaidLanguage(undefined)).toBe(false)
    expect(isMobileMermaidLanguage('')).toBe(false)
    expect(isMobileMermaidLanguage('ts')).toBe(false)
    expect(isMobileMermaidLanguage('mermaidx')).toBe(false)
  })
})

describe('parseMobileMarkdown', () => {
  it('parses mermaid fences as code blocks with language mermaid', () => {
    expect(parseMobileMarkdown('```mermaid\ngraph TD; A-->B\n```')).toEqual([
      { type: 'code', text: 'graph TD; A-->B', language: 'mermaid', closed: true }
    ])
    expect(isMobileMermaidLanguage('mermaid')).toBe(true)
  })

  it('marks an unterminated fence as not closed while it streams', () => {
    expect(parseMobileMarkdown('```mermaid\ngraph TD; A-->B')).toEqual([
      { type: 'code', text: 'graph TD; A-->B', language: 'mermaid', closed: false }
    ])
    expect(parseMobileMarkdown('```mermaid\ngraph TD; A-->B\n```')[0]).toMatchObject({
      closed: true
    })
  })

  it('parses GFM tables into table blocks', () => {
    expect(parseMobileMarkdown('| Name | State |\n| --- | --- |\n| Orca | Open |')).toEqual([
      {
        type: 'table',
        headers: ['Name', 'State'],
        rows: [['Orca', 'Open']]
      }
    ])
  })

  it('keeps an escaped pipe inside the cell that escaped it', () => {
    expect(parseMobileMarkdown('| Cmd | Note |\n| --- | --- |\n| a \\| b | c |')).toEqual([
      {
        type: 'table',
        headers: ['Cmd', 'Note'],
        rows: [['a | b', 'c']]
      }
    ])
  })

  it('ends a cell at the pipe following an escaped backslash', () => {
    // Adapted: this parser reads the block tree from `marked`, which does not collapse a bare `\\`
    // to `\` in a table cell either — only the escape immediately before the separator pipe is its
    // concern. Matches markdown-table-rows.ts's own rule (see the sibling test in markdown-blocks).
    expect(parseMobileMarkdown('| A | B |\n| --- | --- |\n| x\\\\|y |')).toEqual([
      {
        type: 'table',
        headers: ['A', 'B'],
        rows: [['x\\\\', 'y']]
      }
    ])
  })

  it('parses standalone HTTPS images without folding them into paragraphs', () => {
    expect(parseMobileMarkdown('![Screenshot](https://example.com/screen.png)')).toEqual([
      {
        type: 'image',
        alt: 'Screenshot',
        url: 'https://example.com/screen.png'
      }
    ])
  })

  it('normalizes common README HTML into readable Markdown preview text', () => {
    const normalized = normalizeMobileMarkdownPreviewHtml(`
<h1 align="center">
  <a href="https://onOrca.dev"><img src="resources/build/icon.png" alt="Orca" width="64" /></a>
  Orca
</h1>

<p align="center">
  <a href="https://github.com/stablyai/orca/stargazers"><img src="https://badgen.net/github/stars/stablyai/orca" alt="GitHub stars" /></a>
  <strong>The AI Orchestrator</strong><br/>
  Run Codex side-by-side.
</p>
`)

    expect(normalized).toContain('# [Orca](https://onOrca.dev)')
    expect(normalized).toContain('[GitHub stars](https://github.com/stablyai/orca/stargazers)')
    expect(normalized).toContain('**The AI Orchestrator**')
    expect(normalized).not.toContain('<h1')
    expect(normalized).not.toContain('<img')
  })

  it('preserves documented HTML entities while normalizing preview HTML', () => {
    expect(
      normalizeMobileMarkdownPreviewHtml('<p>Use <code>&amp;lt;button&amp;gt;</code></p>')
    ).toBe('Use `&lt;button&gt;`')
  })

  it('preserves angle brackets and generics inside fenced and inline code', () => {
    expect(normalizeMobileMarkdownPreviewHtml('```html\n<div>x</div>\n```')).toBe(
      '```html\n<div>x</div>\n```'
    )
    expect(normalizeMobileMarkdownPreviewHtml('```ts\nconst x: Array<string> = []\n```')).toBe(
      '```ts\nconst x: Array<string> = []\n```'
    )
    expect(normalizeMobileMarkdownPreviewHtml('```ts\nconst x: Array<string> = []')).toBe(
      '```ts\nconst x: Array<string> = []'
    )
    expect(normalizeMobileMarkdownPreviewHtml('Use `Array<string>` here')).toBe(
      'Use `Array<string>` here'
    )
  })

  // Review of the chat code block's Copy button (2026-09-29): only a fence at
  // the margin, opened by exactly three backticks and a bare word, skipped the
  // HTML pass. Every other fence lost its tags, its entities and its blank
  // lines before the parser saw it, so the block drew damaged code and Copy
  // put it on the clipboard. A fence under a list item is the commonest one an
  // agent writes.
  it.each([
    ['under a list item', ['1. Render it:', '', '   ```tsx', '   return <View style={s.row}>', '     <Text>{label}</Text>', '   </View>', '   ```']],
    ['on the list marker line', ['- ```sh', '  echo "a &amp; b" > out.txt', '  ```']],
    ['with tildes', ['~~~html', '<div class="x">hi</div>', '~~~']],
    ['with a title in its info string', ['```html title="a.html"', '<details><summary>x</summary>body</details>', '```']],
    ['with four backticks around a fence', ['````md', '```html', '<b>kept</b>', '```', '````']],
    ['with blank lines and trailing spaces', ['- step', '', '  ```sh', '  echo one  ', '', '', '', '  echo <two>', '  ```']]
  ])('leaves a fence %s exactly as written', (_shape, lines) => {
    const source = lines.join('\n')
    expect(normalizeMobileMarkdownPreviewHtml(source)).toBe(source)
  })

  it('still strips HTML from the prose around a protected fence', () => {
    const source = ['<p>Before</p>', '', '- step', '', '  ```tsx', '  <View />', '  ```', '', '<p>After</p>'].join('\n')
    expect(normalizeMobileMarkdownPreviewHtml(source)).toBe(
      ['Before', '', '- step', '', '  ```tsx', '  <View />', '  ```', '', 'After'].join('\n')
    )
  })

  // Second review (2026-09-29): a line marked does not open as a fence, or a
  // fence marked has already ended, started or kept a protected region, and
  // every tag after it reached the screen and "Copy message" raw.
  it.each([
    ['an indented code block holding only a fence run', ['    ```', '', '<p align="center"><b>Logo</b></p>', '', 'The end &amp; more.']],
    ['a paragraph line indented four spaces', ['Intro', '    ```js', '<b>bold</b>', '', '<p>After</p>']],
    ['an unclosed list fence the next item ends', ['- ```sh', '  echo hi', '- next <b>item</b>', '', '<p>After</p>']],
    ['a list item whose text starts with a fence run', ['- ``` is the fence marker', '- <b>bold</b> item', '', '<p>After</p>']],
    ['a fence nested under a list item, unclosed, then prose at the margin', ['1. step', '', '   ```sh', '   echo hi', 'After <b>the list</b>.', '', '<p>After</p>']]
  ])('strips the HTML after %s', (_shape, lines) => {
    const normalized = normalizeMobileMarkdownPreviewHtml(lines.join('\n'))
    expect(normalized).not.toMatch(/<\/?(?:b|p)\b/)
    expect(normalized).not.toContain('&amp;')
  })

  // Third review (2026-09-29): a leading tab was counted as one column, where
  // marked expands it to the next multiple of four.
  it('keeps a fence after a tab-separated list marker exactly, and strips what follows', () => {
    const fenced = ['1.\t```html', '\t<b>x</b>', '\t```']
    expect(normalizeMobileMarkdownPreviewHtml([...fenced, '', '<p>After</p>'].join('\n'))).toBe(
      [...fenced, '', 'After'].join('\n')
    )
  })

  it.each([
    ['a tab-indented fence run in prose', ['Intro', '', '\t```', '', '<b>bold</b>', '', '<p>After</p>']],
    ['a tab-indented fence run inside a margin fence', ['```md', '\t```', '<b>x</b>', '```', '', '<p>After</p>']]
  ])('reads %s the way marked does', (_shape, lines) => {
    const normalized = normalizeMobileMarkdownPreviewHtml(lines.join('\n'))
    expect(normalized).not.toContain('<p>')
    if (lines[0] === '```md') {
      expect(normalized).toContain('```md\n\t```\n<b>x</b>\n```')
    } else {
      expect(normalized).not.toContain('<b>')
    }
  })

  it('keeps a deeper fence run inside a list fence as code, not as its closer', () => {
    const fenced = ['  ```md', '  text', '      ```', '  <b>still code</b>', '  ```']
    const normalized = normalizeMobileMarkdownPreviewHtml(['- step', '', ...fenced, '', '<p>After</p>'].join('\n'))
    expect(normalized).toBe(['- step', '', ...fenced, '', 'After'].join('\n'))
  })

  it('does not take a triple-backtick span on one line for a fence', () => {
    expect(normalizeMobileMarkdownPreviewHtml('```a<b>c```\n\n<p>After</p>')).toBe('```a<b>c```\n\nAfter')
  })

  it('preserves non-tag angle bracket prose while stripping known HTML tags', () => {
    expect(normalizeMobileMarkdownPreviewHtml('1 < 2 and 3 > 1')).toBe('1 < 2 and 3 > 1')
    expect(normalizeMobileMarkdownPreviewHtml('Array<string> in prose')).toBe(
      'Array<string> in prose'
    )
    expect(normalizeMobileMarkdownPreviewHtml('Promise<Result> in prose')).toBe(
      'Promise<Result> in prose'
    )
    expect(normalizeMobileMarkdownPreviewHtml('Promise<Array<string>> in prose')).toBe(
      'Promise<Array<string>> in prose'
    )
    expect(normalizeMobileMarkdownPreviewHtml('Map<string, Array<number>> in prose')).toBe(
      'Map<string, Array<number>> in prose'
    )
    expect(normalizeMobileMarkdownPreviewHtml('type Box<T = string> = { value: T }')).toBe(
      'type Box<T = string> = { value: T }'
    )
    expect(
      normalizeMobileMarkdownPreviewHtml(
        'type Box<T extends object, Value = string> = { value: Value }'
      )
    ).toBe('type Box<T extends object, Value = string> = { value: Value }')
    expect(normalizeMobileMarkdownPreviewHtml('a<b=c>')).toBe('a<b=c>')
    expect(normalizeMobileMarkdownPreviewHtml('<T> is a type parameter')).toBe(
      '<T> is a type parameter'
    )
    expect(normalizeMobileMarkdownPreviewHtml('<mailto:orca@example.com>')).toBe(
      '<mailto:orca@example.com>'
    )
    expect(normalizeMobileMarkdownPreviewHtml('<ftp://example.com/file>')).toBe(
      '<ftp://example.com/file>'
    )
    expect(normalizeMobileMarkdownPreviewHtml('<tel:+15551234567>')).toBe('<tel:+15551234567>')
    expect(normalizeMobileMarkdownPreviewHtml('<https://example.com>')).toBe(
      '<https://example.com>'
    )
    expect(
      normalizeMobileMarkdownPreviewHtml(
        "<https://en.wikipedia.org/wiki/O'Brien> <svg>hidden</svg>"
      )
    ).toBe("<https://en.wikipedia.org/wiki/O'Brien> hidden")
    expect(normalizeMobileMarkdownPreviewHtml('Replace <your-api-key> now')).toBe(
      'Replace <your-api-key> now'
    )
    expect(
      normalizeMobileMarkdownPreviewHtml(
        '<span title="</your-api-key>"></span> Replace <your-api-key> now'
      )
    ).toBe('Replace <your-api-key> now')
    expect(
      normalizeMobileMarkdownPreviewHtml('<span title="</string>"></span> Array<string> now')
    ).toBe('Array<string> now')
    expect(
      normalizeMobileMarkdownPreviewHtml(
        '<span title=</your-api-key>></span> Replace <your-api-key> now'
      )
    ).toBe('Replace <your-api-key> now')
    expect(
      normalizeMobileMarkdownPreviewHtml('<span title=</string>></span> Array<string> now')
    ).toBe('Array<string> now')
    expect(normalizeMobileMarkdownPreviewHtml('Use <insert name here> next')).toBe(
      'Use <insert name here> next'
    )
    expect(normalizeMobileMarkdownPreviewHtml('<div>Readable text</div>')).toBe('Readable text')
  })

  it('preserves angle brackets inside Markdown code produced from HTML code tags', () => {
    expect(normalizeMobileMarkdownPreviewHtml('<p>Use <code>Array&lt;string&gt;</code></p>')).toBe(
      'Use `Array<string>`'
    )
    expect(
      normalizeMobileMarkdownPreviewHtml('<p>Use <code>&lt;div&gt;x&lt;/div&gt;</code></p>')
    ).toBe('Use `<div>x</div>`')
  })

  it('does not replace literal code placeholder text in markdown prose', () => {
    const literalPlaceholder = '\uE000ORCA_MD_CODE_0\uE000'
    expect(normalizeMobileMarkdownPreviewHtml(`${literalPlaceholder} and \`Array<string>\``)).toBe(
      `${literalPlaceholder} and \`Array<string>\``
    )
  })

  it('strips nested HTML and SVG markup without leaking tag variants', () => {
    expect(
      normalizeMobileMarkdownPreviewHtml(
        '<p>Logo<svg viewBox="0 0 1 1"><g><path d="M0 > 0"/></g></svg> done</p>'
      )
    ).toBe('Logo done')
    expect(normalizeMobileMarkdownPreviewHtml('Logo<svg/onload=alert(1)><path/></svg> done')).toBe(
      'Logo done'
    )
    expect(normalizeMobileMarkdownPreviewHtml('Logo<svg=invalid><path/></svg> done')).toBe(
      'Logo done'
    )
    expect(normalizeMobileMarkdownPreviewHtml('Logo<svg=invalid>Hi')).toBe('LogoHi')
    expect(normalizeMobileMarkdownPreviewHtml('Logo<SVG=invalid>Hi')).toBe('LogoHi')
    expect(normalizeMobileMarkdownPreviewHtml('Logo<path=invalid>Hi')).toBe('LogoHi')
    expect(normalizeMobileMarkdownPreviewHtml('Logo<p=invalid>Hi')).toBe('LogoHi')
    expect(normalizeMobileMarkdownPreviewHtml('Logo<strong=invalid>Hi')).toBe('LogoHi')
    expect(normalizeMobileMarkdownPreviewHtml('Logo<math=invalid>Hi')).toBe('LogoHi')
    expect(normalizeMobileMarkdownPreviewHtml('Logo<foo=invalid>Hi')).toBe('LogoHi')
    expect(normalizeMobileMarkdownPreviewHtml('Logo<my-widget=invalid>Hi')).toBe('LogoHi')
    expect(normalizeMobileMarkdownPreviewHtml('Logo<my-widget disabled>Hi')).toBe('LogoHi')
    expect(normalizeMobileMarkdownPreviewHtml('<svg=invalid><path/>')).toBe('')
    expect(normalizeMobileMarkdownPreviewHtml('Logo<my-widget=invalid>Hi</my-widget> done')).toBe(
      'LogoHi done'
    )
    expect(normalizeMobileMarkdownPreviewHtml('<SVG><PATH/></SVG>')).toBe('')
    expect(normalizeMobileMarkdownPreviewHtml('Logo<svg>Hi<path>there')).toBe('LogoHithere')
    expect(normalizeMobileMarkdownPreviewHtml('Logo<p>Hi')).toBe('LogoHi')
    expect(normalizeMobileMarkdownPreviewHtml('Logo<B>Hi')).toBe('LogoHi')
    expect(normalizeMobileMarkdownPreviewHtml('Logo<strong>Hi')).toBe('LogoHi')
    expect(normalizeMobileMarkdownPreviewHtml('Logo<center>Hi <font>there <marquee>now')).toBe(
      'LogoHi there now'
    )
    expect(normalizeMobileMarkdownPreviewHtml('<center>Title</center>')).toBe('Title')
    expect(normalizeMobileMarkdownPreviewHtml('<my-widget>Hi</my-widget>')).toBe('Hi')
    expect(normalizeMobileMarkdownPreviewHtml('<my:widget>')).toBe('')
    expect(normalizeMobileMarkdownPreviewHtml('<svg:path>')).toBe('')
    expect(normalizeMobileMarkdownPreviewHtml('Logo<foo>Hi</foo> done')).toBe('LogoHi done')
    expect(normalizeMobileMarkdownPreviewHtml('</1>Logo<svg>Hi</svg> done')).toBe('</1>LogoHi done')
    expect(normalizeMobileMarkdownPreviewHtml('Logo<svg>Hi</svg   > done')).toBe('LogoHi done')
    expect(normalizeMobileMarkdownPreviewHtml('&lt;svg&gt;&lt;path/&gt;&lt;/svg&gt;')).toBe(
      '<svg><path/></svg>'
    )
    expect(normalizeMobileMarkdownPreviewHtml('<p>Use &lt;svg&gt; icons</p>')).toBe(
      'Use <svg> icons'
    )
    expect(normalizeMobileMarkdownPreviewHtml('<p title="a > b">x</p>')).toBe('x')
    expect(normalizeMobileMarkdownPreviewHtml("<p title='a > b'>x</p>")).toBe('x')
    expect(normalizeMobileMarkdownPreviewHtml('<img alt="a > b">')).toBe('a > b')
    expect(
      normalizeMobileMarkdownPreviewHtml('<a title="a > b" href="https://example.com">link</a>')
    ).toBe('[link](https://example.com)')
    expect(
      normalizeMobileMarkdownPreviewHtml(
        '<a href="https://example.com">first <a href="https://example.com">second'
      )
    ).toBe('first second')
    expect(
      normalizeMobileMarkdownPreviewHtml(
        '<a-widget href="https://wrong.example">custom</a-widget> <a href="https://example.com">real</a>'
      )
    ).toBe('custom [real](https://example.com)')
    expect(
      normalizeMobileMarkdownPreviewHtml(
        '<a data-href="https://wrong.example" href="https://example.com">real</a>'
      )
    ).toBe('[real](https://example.com)')
    expect(
      normalizeMobileMarkdownPreviewHtml(
        '<a title="see href=https://wrong.example" href="https://example.com">real</a>'
      )
    ).toBe('[real](https://example.com)')
    expect(
      normalizeMobileMarkdownPreviewHtml('<a data-href="https://wrong.example">plain</a>')
    ).toBe('plain')
    expect(normalizeMobileMarkdownPreviewHtml('<img data-alt="wrong" alt="right">')).toBe('right')
    expect(
      normalizeMobileMarkdownPreviewHtml(
        '<a:widget href="https://wrong.example">custom</a:widget> <a href="https://example.com">real</a>'
      )
    ).toBe('custom [real](https://example.com)')
    expect(
      normalizeMobileMarkdownPreviewHtml(
        '<a=invalid href="https://wrong.example">bad <a href="https://example.com">real</a>'
      )
    ).toBe('bad [real](https://example.com)')
    expect(
      normalizeMobileMarkdownPreviewHtml(
        '<a href="https://wrong.example"/>bad <a href="https://example.com">real</a>'
      )
    ).toBe('bad [real](https://example.com)')
    expect(
      normalizeMobileMarkdownPreviewHtml(
        '<a href="https://wrong.example">bad <a href="https://example.com">real</a>'
      )
    ).toBe('bad [real](https://example.com)')
    expect(
      normalizeMobileMarkdownPreviewHtml(
        'before<p title="unterminated>middle<svg><path/></svg>after'
      )
    ).toBe('beforemiddleafter')
    expect(normalizeMobileMarkdownPreviewHtml('before<p title=x<svg><path/></svg>after')).toBe(
      'beforeafter'
    )
    expect(normalizeMobileMarkdownPreviewHtml('<p>first</p><p>second')).toBe('first\nsecond')
    expect(normalizeMobileMarkdownPreviewHtml('<strong>first</strong><strong>second')).toBe(
      '**first**second'
    )
    expect(
      normalizeMobileMarkdownPreviewHtml(
        '<strong-widget>custom</strong-widget> <strong>real</strong>'
      )
    ).toBe('custom **real**')
    expect(
      normalizeMobileMarkdownPreviewHtml('Logo<strong=invalid>Hi <strong>real</strong> done')
    ).toBe('LogoHi **real** done')
    expect(normalizeMobileMarkdownPreviewHtml('Logo<strong />Hi <strong>real</strong> done')).toBe(
      'LogoHi **real** done'
    )
    expect(normalizeMobileMarkdownPreviewHtml('<strong>bad <strong>real</strong> done')).toBe(
      'bad **real** done'
    )
    expect(normalizeMobileMarkdownPreviewHtml(`${'<p>x'.repeat(4096)}</p>`)).toBe(
      `${'x'.repeat(4095)}\nx`
    )
  })

  it('accepts the `|:-:|` and single-dash separators agents emit, and escaped pipes in cells', () => {
    const blocks = parseMobileMarkdown('| Job | Result |\n|:-:|-|\n| 2621 | a \\| b |')
    expect(blocks).toEqual([{ type: 'table', headers: ['Job', 'Result'], rows: [['2621', 'a | b']] }])
  })
})
