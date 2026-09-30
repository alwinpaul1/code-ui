// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { editedSurface, openedSurface, savedUntouched } from './rich-markdown-round-trip.test-support'

// Review, 2026-09-30: an entity the source wrote was saved as the character it stands for. The
// renderer decodes entities to draw them (escapeHtml runs decodeMarkdownEntities first) and the
// writer writes the text, which has no way back to the entity, so 'Write &lt;div&gt; for a block'
// saved as 'Write <div> for a block': a raw HTML tag, which changes the meaning and can make the
// text vanish wherever the file is rendered. A run of text that holds an entity now remembers how
// its source wrote it, and a save writes that back; what the user types beside it is written as
// typed. Raw HTML in the source was never decoded and still saves as written.
describe('an entity written in the source', () => {
  it.each([
    ['an escaped tag', 'Write &lt;div&gt; for a block'],
    ['a generic type', 'a List&lt;T&gt; here'],
    ['an escaped element', 'a &lt;b&gt;c&lt;/b&gt; d'],
    ['an escaped ampersand', 'AT&amp;T'],
    ['an escaped entity', 'write &amp;lt; for <'],
    ['numeric entities', '&#60;div&#62; and &#x3C;p&#x3E;'],
    ['an escaped emphasis mark', '&#42;not italic&#42;'],
    ['quotes', '&quot;a&quot; and &apos;b&apos;'],
    ['an entity in bold', 'a **&lt;b&gt;** c'],
    ['an entity in a link’s words', '[a &amp; b](https://x.dev/a)'],
    ['an entity in a heading', '# A &amp; B'],
    ['an entity in a list item', '- &lt;x&gt;\n- y'],
    ['an entity in a table cell', '| &lt;a&gt; | b |\n| --- | --- |\n| 1 | 2 |'],
    ['an entity in a quote', '> &lt;q&gt;\n> next'],
    ['an entity in a code span', 'use `&lt;div&gt;` here'],
    ['an entity in a fenced block', '```html\n&lt;div&gt; &amp;\n```'],
    ['raw HTML, which is not decoded', 'press <kbd>Ctrl</kbd> & <b>go</b>'],
    ['an unknown entity', '&copy; 2026']
  ])('saves %s back as written', (_name, markdown) => {
    expect(savedUntouched(markdown)).toBe(markdown)
  })

  it('draws an entity as its character, and one in code as written', () => {
    expect(openedSurface('Write &lt;div&gt; for a block').editor.textContent).toBe(
      'Write <div> for a block'
    )
    expect(openedSurface('write &amp;lt;').editor.textContent).toBe('write &lt;')
    expect(openedSurface('use `&lt;div&gt;`').editor.querySelector('code')?.textContent).toBe(
      '&lt;div&gt;'
    )
    expect(openedSurface('```\n&lt;div&gt;\n```').editor.querySelector('code')?.textContent).toBe(
      '&lt;div&gt;'
    )
    expect(openedSurface('&#42;not italic&#42;').editor.querySelector('em')).toBeNull()
  })

  it('keeps the entities beside what the user types, and writes the typing as typed', () => {
    const { editor, saved } = openedSurface('Write &lt;div&gt; for a block')
    const text = editor.querySelector('p')!.firstChild!.firstChild!
    text.textContent = 'Write <div> <x> for a block, typed'
    expect(saved()).toBe('Write &lt;div&gt; <x> for a block, typed')
    text.textContent = 'Write  for a block'
    expect(saved()).toBe('Write  for a block')
  })

  it('keeps each half’s entities when Enter splits the text between two paragraphs', () => {
    // The engine clones the run's element, and its attribute, into the new paragraph.
    const { editor, saved } = openedSurface('a &lt; b &gt; c')
    const run = editor.querySelector('p')!.firstElementChild!
    const clone = run.cloneNode(false) as Element
    clone.textContent = '> c'
    run.textContent = 'a < b '
    const paragraph = document.createElement('p')
    paragraph.append(clone)
    editor.append(paragraph)
    expect(saved()).toBe('a &lt; b\n\n&gt; c')
  })

  it('keeps the entities when part of the text is made bold', () => {
    const { editor, saved } = openedSurface('a &lt; b &gt; c')
    const run = editor.querySelector('p')!.firstElementChild!
    run.innerHTML = 'a &lt; <strong>b</strong> &gt; c'
    expect(saved()).toBe('a &lt; **b** &gt; c')
  })

  it('writes the text as it is when the remembered source cannot be read', () => {
    const { editor, saved } = openedSurface('a &lt; b')
    editor.querySelector('p')!.firstElementChild!.setAttribute('data-md-source', '%E0%A4%A')
    expect(saved()).toBe('a < b')
  })

  // The sweep for the same shape found it in addresses: a bare or bracketed address drew its
  // words decoded and saved them that way, so a shields.io badge URL written inside raw HTML
  // (ORCA-UPSTREAM-README.md) lost its `&amp;`s on save.
  it.each([
    ['a bare address', 'see https://x.dev/?a=1&amp;b=2 now'],
    ['an address in angle brackets', 'see <https://x.dev/?a=1&amp;b=2> now'],
    ['an address inside raw HTML', '<img src="https://img.shields.io/x?style=flat&amp;label=a" />']
  ])('saves the entities in %s as written, and opens the address they spell', (_name, markdown) => {
    const { editor, saved } = openedSurface(markdown)
    expect(editor.querySelector('a')?.getAttribute('href')).toContain('&')
    expect(editor.querySelector('a')?.getAttribute('href')).not.toContain('&amp;')
    expect(saved()).toBe(markdown)
  })

  it('writes an address the user retitled as an explicit link, entities or not', () => {
    const { editor, saved } = openedSurface('see https://x.dev/?a=1&amp;b=2 now')
    editor.querySelector('a')!.textContent = 'docs'
    expect(saved()).toBe('see [docs](https://x.dev/?a=1&b=2) now')
  })

  it('still writes a < the user types as typed', () => {
    expect(editedSurface('<p>a < b</p>').saved()).toBe('a < b')
  })

  it('draws text with no entity in it as it always has', () => {
    expect(openedSurface('plain text').html).toBe('<p>plain text</p>')
    expect(openedSurface('R&D and <tag>').html).toBe('<p>R&amp;D and &lt;tag&gt;</p>')
  })
})
