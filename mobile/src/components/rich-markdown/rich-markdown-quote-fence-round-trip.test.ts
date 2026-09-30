// @vitest-environment happy-dom
import { marked } from 'marked'
import { describe, expect, it } from 'vitest'
import { editedSurface, openedSurface, savedUntouched } from './rich-markdown-round-trip.test-support'

// Review, 2026-09-30: a quote's lines were read as one run of words, so the backticks of a fenced
// block inside it became an inline code span: '> ```\n> x\n> ```' saved as '> ```x```', and a tilde
// fence as strikethrough ('> ~\n> ~~x~~\n> ~'). A quote now reads its code blocks as blocks (a
// `<pre>` inside the `<blockquote>`), and a save writes them back line by line behind '> '.
describe('a code block inside a quote', () => {
  it.each([
    ['a one-line fence', '> ```\n> x\n> ```'],
    ['a fence with a language tag', '> ```ts\n> const a = 1\n> ```'],
    ['an empty fence', '> ```\n> ```'],
    ['a tilde fence', '> ~~~\n> x\n> ~~~'],
    ['text, a fence, then text, blank lines between', '> a\n>\n> ```\n> x\n> ```\n>\n> b'],
    ['text, a fence, then text, no blank lines between', '> a\n> ```\n> x\n> ```\n> b'],
    ['a fence with a blank line inside it', '> ```sh\n> ls\n>\n> echo\n> ```'],
    ['a fence holding quote and list markers', '> ```md\n> > not a quote\n> - not a list\n> ```'],
    ['a fence indented inside the quote', '>  ```\n>  x\n>  ```'],
    ['a longer fence around a backtick run', '> ````\n> ```\n> ````'],
    ['a code line of spaces', '> ```\n>    \n> ```'],
    ['two fences in a row', '> ```\n> a\n> ```\n> ```\n> b\n> ```'],
    ['an indented code block', '>     code\n>       more'],
    ['an indented code block after text', '> a\n>\n>     code'],
    ['a fence inside a nested quote', '> > ```\n> > x\n> > ```'],
    ['text and then a nested quote', '> a\n> > b'],
    ['a nested quote and then text', '> > a\n> b']
  ])('keeps %s', (_name, markdown) => {
    expect(savedUntouched(markdown)).toBe(markdown)
  })

  it('keeps a fenced block inside a blockquote as a code block, as the desktop reads it', () => {
    const markdown = '> ```ts\n> x\n> ```'
    const { editor } = openedSurface(markdown)
    const code = editor.querySelector('blockquote > pre > code')
    expect(code?.textContent).toBe('x')
    expect(code?.parentElement?.getAttribute('data-language')).toBe('ts')
    expect(marked.parse(markdown, { async: false })).toContain('<blockquote>\n<pre><code')
  })

  it('draws the words around a fence as paragraphs of the quote', () => {
    const { editor } = openedSurface('> a\n> ```\n> x\n> ```\n> b')
    const blocks = Array.from(editor.querySelector('blockquote')!.children)
    expect(blocks.map((block) => [block.tagName, block.textContent])).toEqual([
      ['P', 'a'],
      ['PRE', 'x'],
      ['P', 'b']
    ])
  })

  it('closes a fence the quote ended before its closing line', () => {
    expect(savedUntouched('> ```\n> x\n\nafter')).toBe('> ```\n> x\n> ```\n\nafter')
  })

  it('keeps the code when a paragraph beside it is edited', () => {
    const { editor, saved } = openedSurface('> a\n> ```\n> x\n> ```')
    editor.querySelector('blockquote > p')!.textContent = 'a, edited'
    expect(saved()).toBe('> a, edited\n> ```\n> x\n> ```')
  })

  it('keeps two paragraphs apart when Enter copies the no-blank mark onto a second one', () => {
    // The engine clones a paragraph's attributes onto the one Enter makes. Two paragraphs written
    // with no blank line between them would be read back as one, so the mark only holds against a
    // code block or a quote.
    const { saved } = editedSurface(
      '<blockquote><pre data-language=""><code>x</code></pre>' +
        '<p data-md-quote-tight="true">a</p><p data-md-quote-tight="true">b</p></blockquote>'
    )
    expect(saved()).toBe('> ```\n> x\n> ```\n> a\n>\n> b')
  })

  it('keeps a fenced block inside a quote inside a quote as a code block', () => {
    const { editor } = openedSurface('> > ```\n> > x\n> > ```')
    expect(editor.querySelector('blockquote > blockquote > pre > code')?.textContent).toBe('x')
  })

  it('reads quotes nested past eight levels as text rather than overflowing the stack', () => {
    // The chat's parser pins 12,000 levels (mobile-markdown-parser-progress.test.ts). A reader that
    // recursed once a level would throw on that document; past the eighth level the rest is words,
    // as every quote's inside was before 2026-09-30, and it is written back as it was.
    const deep = `${'> '.repeat(12_000)}buried`
    expect(savedUntouched(deep)).toBe(deep)
    const { editor } = openedSurface(deep)
    expect(editor.querySelectorAll('blockquote')).toHaveLength(8)
  })
})

// Found beside the quote's empty fence: every empty fence, at the margin or in a list item too,
// saved with a blank line added ('```\n```' as '```\n\n```'), because an empty `<code>` is also what
// one blank line draws as. The fence now keeps its count of blank lines where that is not one.
describe('a fence with no code line, or only blank ones', () => {
  it.each([
    ['at the margin', '```\n```'],
    ['in a list item', '- a\n  ```\n  ```\n- b'],
    ['with a language tag', '```ts\n```'],
    ['holding one blank line', '```\n\n```'],
    ['holding two blank lines', '```\n\n\n```'],
    ['holding two blank lines in a quote', '> ```\n>\n>\n> ```']
  ])('keeps an empty fence %s', (_name, markdown) => {
    expect(savedUntouched(markdown)).toBe(markdown)
  })

  it('writes what was typed into an empty fence, not its count of lines', () => {
    const { editor, saved } = openedSurface('```\n```')
    editor.querySelector('pre code')!.textContent = 'typed'
    expect(saved()).toBe('```\ntyped\n```')
  })
})
