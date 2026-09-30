// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { createRichMarkdownEditorScope } from './document-scope'
import { listMarkdown } from './html-list-markdown'
import { markdownToHtml } from './markdown-to-html'
import { RICH_MARKDOWN_EDITOR_MARKUP } from './document-markup'
import { currentMarkdown } from './editor-content'
import { startEditorSurface } from './editor-surface'

/**
 * Markdown into the surface and back out of it, over a real document.
 *
 * These are the document's two halves and they are only correct together: a renderer that loses an
 * ordered list's start and a serializer that renumbers from one agree with each other and lose the
 * user's text. So each case renders, then reads the markup back, and the source it began with is
 * the assertion.
 *
 * Against real elements rather than shaped objects. The serializer reads `closest`, `children`,
 * `cloneNode` and a checkbox's `checked`, and a stand-in for those is a stand-in for the thing
 * being tested — which is how the old fixtures could describe a list no renderer would produce.
 */
function surface(markdown: string, options: { editable?: boolean } = {}) {
  document.body.innerHTML = RICH_MARKDOWN_EDITOR_MARKUP
  const scope = createRichMarkdownEditorScope()
  scope.editable = options.editable ?? true
  startEditorSurface(scope)
  const editor = document.getElementById('editor')!
  editor.innerHTML = markdownToHtml(scope, markdown)
  return { scope, editor, html: editor.innerHTML }
}

/**
 * The surface holding a paragraph that carries a list inside it, which is what an engine leaves.
 *
 * Built through the paragraph's own `innerHTML` rather than the editor's: the HTML parser closes a
 * `<p>` before a `<ul>`, so `editor.innerHTML = '<p><ul>...'` gives two siblings and would measure
 * the flat shape while claiming to measure the nested one. Each case asserts the nesting it got.
 */
function nestedListSurface(paragraphMarkup: string) {
  document.body.innerHTML = RICH_MARKDOWN_EDITOR_MARKUP
  const scope = createRichMarkdownEditorScope()
  scope.editable = true
  startEditorSurface(scope)
  const editor = document.getElementById('editor')!
  const paragraph = document.createElement('p')
  paragraph.innerHTML = paragraphMarkup
  editor.append(paragraph)
  return { scope, editor }
}

/** The item markup WebKit wraps the paragraph's text in: a styled span and a trailing break. */
const webkitItem = (text: string) =>
  `<li><span style="font-family: var(--font-sans);">${text}</span><br></li>`

describe('the editor document, from markdown and back', () => {
  it('renders and serializes nested bullet, ordered and task lists with indentation intact', () => {
    const markdown = [
      '- Parent',
      '  1. Ordered child',
      '    - [x] Done task',
      '    - [ ] Open task',
      '- Sibling'
    ].join('\n')

    const { scope, html } = surface(markdown)

    expect(html).toContain(
      '<ul><li><p>Parent</p><ol start="1"><li value="1" data-list-number="1"><p>Ordered child</p>'
    )
    expect(html).toContain('<ul data-type="taskList">')
    expect(html).toContain('<li><p>Sibling</p></li></ul>')
    expect(currentMarkdown(scope)).toBe(markdown)
  })

  it('serializes a bullet list the engine nested inside a paragraph, as the flat shape does', () => {
    // Captured from the render rig, not written from memory: on WebKit 26.4 and Chromium 147 alike,
    // `insertUnorderedList` over `<p>alpha</p>` leaves `<p><ul><li>alpha</li></ul></p>` rather than
    // replacing the paragraph, and WebKit additionally wraps the item's text in a styled span.
    const { scope, editor } = nestedListSurface(
      `<ul>${webkitItem('alpha')}${webkitItem('beta')}</ul>`
    )

    expect(editor.querySelector('ul')?.parentElement?.tagName).toBe('P')
    const markdown = ['- alpha', '- beta'].join('\n')
    expect(currentMarkdown(scope)).toBe(markdown)
    // The flat shape the renderer produces from that same source, so the two shapes agree.
    expect(currentMarkdown(surface(markdown).scope)).toBe(markdown)
  })

  it('serializes a numbered list the engine nested inside a paragraph', () => {
    // The same capture with the Numbered list command: `<p><ol><li>...</li></ol></p>` on both.
    const { scope, editor } = nestedListSurface(
      `<ol>${webkitItem('first')}${webkitItem('second')}</ol>`
    )

    expect(editor.querySelector('ol')?.parentElement?.tagName).toBe('P')
    expect(currentMarkdown(scope)).toBe(['1. first', '2. second'].join('\n'))
  })

  it('reads a paragraph that holds a list and text around it as separate blocks', () => {
    // The trailing half is captured: leaving the list with two returns and typing puts the text in
    // a `<div>` beside the `<ul>`, both still inside the one `<p>`. Text before the list is the
    // same rule read forward — a run of inline content is a paragraph wherever it sits.
    const { scope, editor } = nestedListSurface(
      'before the list<ul><li>solo</li></ul><div>after the list</div>'
    )

    expect(editor.querySelector('ul')?.parentElement?.tagName).toBe('P')
    expect(currentMarkdown(scope)).toBe(
      ['before the list', '', '- solo', '', 'after the list'].join('\n')
    )
  })

  it('renders markdown entities as characters without double-escaping them', () => {
    const { html } = surface('R&D &amp; Sales and &lt;tag&gt;')

    expect(html).toContain('R&amp;D &amp; Sales and &lt;tag&gt;')
    expect(html).not.toContain('&amp;amp;')
  })

  it('preserves explicit ordered-list numbering through the round trip', () => {
    const markdown = ['3. Third step', '4. Fourth step'].join('\n')
    const { scope, html } = surface(markdown)

    expect(html).toContain('<ol start="3">')
    expect(html).toContain('data-list-number="3"')
    expect(currentMarkdown(scope)).toBe(markdown)
  })

  it('serializes ordered lists from the parent start when item metadata is missing', () => {
    // What a paste leaves behind: the list carries a start and its items carry nothing, which is
    // the one case where position rather than an attribute decides the number.
    document.body.innerHTML = RICH_MARKDOWN_EDITOR_MARKUP
    const editor = document.getElementById('editor')!
    editor.innerHTML = '<ol start="8"><li><p>Pasted step</p></li><li><p>Inserted step</p></li></ol>'

    expect(listMarkdown(editor.firstElementChild!, 0)).toBe(
      ['8. Pasted step', '9. Inserted step'].join('\n')
    )
  })

  it('renders task checkboxes as disabled while the surface is read-only', () => {
    expect(surface('- [ ] Read-only task', { editable: false }).html).toContain(
      'type="checkbox" disabled'
    )
    expect(surface('- [ ] Editable task').html).not.toContain('disabled')
  })

  it('round-trips every block the toolbar can produce', () => {
    const markdown = [
      '# Title',
      '',
      'Body with **bold**, *italic*, ~~strike~~ and `code`.',
      '',
      '> Quoted line',
      '',
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '```ts',
      'const x = 1',
      '```',
      '',
      '---',
      '',
      '[docs](https://example.com/docs)',
      '',
      '![alt](https://example.com/a.png)'
    ].join('\n')

    expect(currentMarkdown(surface(markdown).scope)).toBe(markdown)
  })

  it('makes progress on a marker with nothing after it, rather than reading it forever', () => {
    // `isBlockStart` admits `# ` and the list test admits `- `, but the heading reader needs text
    // after the hashes and `parseListLine` needs text after the marker, so neither consumed the
    // line and the index never moved: `markdownToHtml` looped forever on a one-line source the
    // host could hand it from any file. Bare markers are text.
    // CODE UI: without the trailing space. This fork reflows a paragraph (markdown-reflow.ts),
    // and a paragraph's trailing whitespace goes with it, as CommonMark drops it.
    expect(markdownToHtml(createRichMarkdownEditorScope(), '# ')).toBe('<p>#</p>')
    expect(markdownToHtml(createRichMarkdownEditorScope(), '- ')).toBe('<p>-</p>')
    expect(markdownToHtml(createRichMarkdownEditorScope(), '1. ')).toBe('<p>1.</p>')
    // The control, so the guard is not swallowing the readers it falls back from.
    expect(markdownToHtml(createRichMarkdownEditorScope(), '# ok')).toBe('<h1>ok</h1>')
    expect(markdownToHtml(createRichMarkdownEditorScope(), '- ok')).toBe(
      '<ul><li><p>ok</p></li></ul>'
    )
  })

  it('renders no link for a javascript: URL, which is the one scheme it filters', () => {
    // The refused token is kept as the text it is, so the URL survives as inert text rather than
    // disappearing (it fell through to the italic branch until 2026-09-30, and saved as
    // `*tap](javascript:alert(1*)`). What must not survive is an element that can be tapped.
    const { html } = surface('[tap](javascript:alert(1))')
    expect(html).not.toContain('<a')
    expect(html).not.toContain('href')
  })

  it('round-trips a code block that holds a fence of its own', () => {
    // The fence has to be longer than the longest run inside it, or the block ends at its content:
    // a three-backtick reader took the inner line for the close and the rest became paragraphs.
    const markdown = ['````', '```', 'nested', '```', '````'].join('\n')
    const { scope, html } = surface(markdown)

    expect(html).toContain('<pre data-language=""><code>```\nnested\n```</code></pre>')
    expect(currentMarkdown(scope)).toBe(markdown)
  })

  // Review, 2026-09-30: prose maths drew as emphasis, `x ** 2 and y ** 3` as
  // `x <strong> 2 and y </strong> 3`, the way the chat did
  // (MobileMarkdown.spaced-operators.test.tsx). The source survived a save
  // only because the serializer wrote the same stars back around the wrong
  // words; any edit inside them saved the user's maths as bold.
  it.each([
    ['prose maths', 'area = x ** 2 + y ** 2, or 2 * 3 * 4'],
    ['a spaced power', 'x ** 2 and y ** 3'],
    ['a spaced product', 'a * b * c'],
    ['a glob', 'glob: * and *'],
    ['spaced underscores', 'x __ y __ z and x _ y _ z'],
    ['a fill-in blank', 'Name: *** Date: ***']
  ])('draws %s as the text it is and saves it back as written', (_name, markdown) => {
    const { scope, html } = surface(markdown)
    expect(html).toBe(`<p>${markdown}</p>`)
    expect(currentMarkdown(scope)).toBe(markdown)
  })

  it('draws operators in a heading, a list item and a table cell as text', () => {
    const markdown = [
      '# Cost is n * m * 4',
      '',
      '- grows as 2 ** n',
      '- or n * n',
      '',
      '| formula | note |',
      '| --- | --- |',
      '| w * h / 2 | x ** 2 |'
    ].join('\n')
    const { scope, html } = surface(markdown)
    expect(html).not.toMatch(/<(strong|em)>/)
    expect(currentMarkdown(scope)).toBe(markdown)
  })

  it('still draws emphasis whose runs touch its words beside the maths', () => {
    const markdown = 'x ** 2 is **bold**, *it* and *a*, not 2 * 3'
    const { scope, html } = surface(markdown)
    expect(html).toBe('<p>x ** 2 is <strong>bold</strong>, <em>it</em> and <em>a</em>, not 2 * 3</p>')
    expect(currentMarkdown(scope)).toBe(markdown)
  })

  it('round-trips a table cell that holds a pipe, and the backslash that hid it', () => {
    // A cell's own pipe is the row separator unless a backslash claims it. Code UI: only the pipe's
    // backslash is the table's; `c\\d` shows as written, as it does in a paragraph (the editor
    // renders no backslash escapes) and as it did before #22054, which unescaped it here and
    // doubled every lone backslash on save (markdown-table-rows.ts).
    const markdown = ['| a \\| b | c\\\\d |', '| --- | --- |', '| 1 \\| 2 | 3 |'].join('\n')
    const { scope, html } = surface(markdown)

    expect(html).toContain('<th>a | b</th><th>c\\\\d</th>')
    expect(html).toContain('<td>1 | 2</td><td>3</td>')
    expect(currentMarkdown(scope)).toBe(markdown)
  })
})

// Review, 2026-09-30: opening a document and saving it rewrote its links. The editor read a link's
// words to the first `]` and its address to the first `)`, and a bare address ran on through `)`,
// `>` and a closing full stop, so a README badge saved as `[![CI](…)]([https://x/r)](https://x/r))`
// and every bare address came back as `[address](address)`. The chat and PR renderers had the same
// rules fixed in round 1 (MobileMarkdown.link-shapes.test.ts); the editor now reads the chat's.
describe('links and addresses, from markdown and back', () => {
  it.each([
    ['a README badge', '[![CI](https://x/b.svg)](https://x/r)'],
    ['an address inside parentheses', '(see https://x.dev/a) now'],
    ['an address before a full stop', 'see https://x.dev/a.'],
    ['a link whose address holds parentheses', '[Foo](https://en.wikipedia.org/wiki/Foo_(bar)) now'],
    ['an address in angle brackets', '<https://x.dev/a> z'],
    ['a bare address', 'see https://x.dev/a now'],
    ['an address alone on a line', 'https://x.dev/a'],
    ['an explicit link whose words are its address', '[https://x.dev/a](https://x.dev/a)'],
    ['a mailto address in angle brackets', 'write <mailto:a@b.co> now'],
    ['an email address in angle brackets', 'write <a@b.co> now'],
    ['a link beside an address', 'the [docs](https://x.dev/d), or https://x.dev/e, or <https://x.dev/f>.'],
    ['addresses in list items', '- see https://x.dev/a now\n- <https://x.dev/b>'],
    ['an address in a heading', '# Docs at https://x.dev/a'],
    ['an address in a quote', '> see https://x.dev/a.'],
    ['addresses in a table', '| a | b |\n| --- | --- |\n| https://x.dev/a | [d](https://x.dev/d) |'],
    ['a bold address and a link with bold words', '**https://x.dev/a** and [**b**](https://x.dev/b)']
  ])('saves %s back as it was written', (_name, markdown) => {
    expect(currentMarkdown(surface(markdown).scope)).toBe(markdown)
  })

  it('draws a badge as a link to the repository around the badge image', () => {
    const { editor } = surface('[![CI](https://x/b.svg)](https://x/r)')
    const link = editor.querySelector('a')!
    expect(link.getAttribute('href')).toBe('https://x/r')
    expect(link.innerHTML).toBe('<img src="https://x/b.svg" alt="CI">')
    expect(editor.textContent).toBe('')
  })

  it('opens an address without the parenthesis, full stop or brackets around it', () => {
    const links = (markdown: string) =>
      Array.from(surface(markdown).editor.querySelectorAll('a')).map((link) => [
        link.getAttribute('href'),
        link.textContent
      ])
    expect(links('(see https://x.dev/a) now')).toEqual([['https://x.dev/a', 'https://x.dev/a']])
    expect(links('see https://x.dev/a.')).toEqual([['https://x.dev/a', 'https://x.dev/a']])
    expect(links('<https://x.dev/a> z')).toEqual([['https://x.dev/a', 'https://x.dev/a']])
    expect(links('write <a@b.co> now')).toEqual([['mailto:a@b.co', 'a@b.co']])
    expect(links('[Foo](https://en.wikipedia.org/wiki/Foo_(bar)) now')).toEqual([
      ['https://en.wikipedia.org/wiki/Foo_(bar)', 'Foo']
    ])
    expect(surface('(see https://x.dev/a) now').editor.textContent).toBe('(see https://x.dev/a) now')
  })

  it.each([
    ['empty words and address', '[]()'],
    ['an empty address', '[a]()'],
    ['empty words', '[](x)'],
    ['an address that never closes', '[a](b(c'],
    ['a scheme with nothing after it', 'see https:// now'],
    ['an empty pair of angle brackets', 'a <> b']
  ])('keeps %s as the text it is', (_name, markdown) => {
    const { scope, editor } = surface(markdown)
    expect(editor.querySelector('a, img')).toBeNull()
    expect(currentMarkdown(scope)).toBe(markdown)
  })

  it('draws an image with no alt text and saves it back', () => {
    const { scope, editor } = surface('![](x)')
    expect(editor.querySelector('img')?.getAttribute('src')).toBe('x')
    expect(currentMarkdown(scope)).toBe('![](x)')
  })

  it('saves an empty document as nothing', () => {
    expect(currentMarkdown(surface('').scope)).toBe('')
  })

  it('draws no link or image for a javascript: address, and saves it back as written', () => {
    for (const markdown of ['[tap](javascript:alert(1))', '![x](javascript:alert(1))', '[![x](y)](javascript:z)']) {
      const { scope, html } = surface(markdown)
      expect(html).not.toMatch(/<a|href/)
      expect(currentMarkdown(scope)).toBe(markdown)
    }
  })

  it('saves an address the user retitled as an explicit link, so neither its words nor its address is lost', () => {
    const { scope, editor } = surface('see https://x.dev/a now')
    editor.querySelector('a')!.textContent = 'the docs'
    expect(currentMarkdown(scope)).toBe('see [the docs](https://x.dev/a) now')

    const angle = surface('write <a@b.co> now')
    angle.editor.querySelector('a')!.innerHTML = '<strong>a@b.co</strong>'
    expect(currentMarkdown(angle.scope)).toBe('write [**a@b.co**](mailto:a@b.co) now')
  })

  // The editor reads escapes as the chat's matcher does: an escaped mark opens nothing. It drew
  // `\*a\*` as a backslash and an italic "a\" before; both readings saved back as written, and
  // the backslashes stay in the text either way.
  it.each([
    ['escaped stars', 'not \\*italic\\* here'],
    ['an escaped link', 'not \\[a link](docs/a.md) here'],
    ['an escaped backslash before an italic', 'a \\\\*b* c']
  ])('saves %s back as written, drawing only what is not escaped', (_name, markdown) => {
    const { scope, editor } = surface(markdown)
    expect(editor.querySelector('a')).toBeNull()
    expect(Array.from(editor.querySelectorAll('em')).map((em) => em.textContent)).toEqual(
      markdown.includes('\\\\*') ? ['b'] : []
    )
    expect(currentMarkdown(scope)).toBe(markdown)
  })

  it('saves a link the toolbar made as an explicit link, even when its words are its address', () => {
    const { scope, editor } = surface('x')
    editor.innerHTML = '<p>see <a href="https://x.dev/a">https://x.dev/a</a> now</p>'
    expect(currentMarkdown(scope)).toBe('see [https://x.dev/a](https://x.dev/a) now')
  })
})
