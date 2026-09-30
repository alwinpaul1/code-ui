// @vitest-environment happy-dom
// Review, 2026-09-30: the editor drew `***x***` as a star, bold x, a star, and
// `**a *b* c**` as a star, italic "a ", plain "b", italic " c", a star, because
// its bold rule could not hold a star. The stars it drew were text in the
// document, so saving kept them there. The chat renderer had the same rule
// fixed in 35e8f142. Runs the shipped bundle, as the editor does.
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it } from 'vitest'
import { RICH_MARKDOWN_EDITOR_DOCUMENT_SCRIPT } from '../rich-markdown-editor-document-script.generated'
import { RICH_MARKDOWN_EDITOR_MARKUP } from './document-markup'
import { renderInline } from './markdown-inline-render'

function openShippedDocument() {
  document.body.innerHTML = RICH_MARKDOWN_EDITOR_MARKUP
  Object.assign(globalThis, {
    ReactNativeWebView: { postMessage: () => {} },
    visualViewport: { height: 500, offsetTop: 0, addEventListener: () => {}, removeEventListener: () => {} },
    innerHeight: 800
  })
  new Function(RICH_MARKDOWN_EDITOR_DOCUMENT_SCRIPT)()
  return window.__orcaRichMarkdown!
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, '__orcaRichMarkdown')
  document.body.innerHTML = ''
})

describe('emphasis nested inside emphasis in the editor', () => {
  it('draws a bold holding an italic as nested marks, with no stars', () => {
    expect(renderInline('***x***')).toBe('<strong><em>x</em></strong>')
    expect(renderInline('**a *b* c**')).toBe('<strong>a <em>b</em> c</strong>')
    expect(renderInline('___x___')).toBe('<strong><em>x</em></strong>')
    expect(renderInline('__a _b_ c__')).toBe('<strong>a <em>b</em> c</strong>')
  })

  // The serializer spells every emphasis with stars (it saved `__bye__` as
  // `**bye**` before this too), so the underscore forms come back as stars:
  // the same marks, none gained or lost.
  it.each([
    ['bold and italic at once', 'This is ***really important*** now.', 'This is ***really important*** now.'],
    ['a bold holding an italic', 'A **bold with *em* inside** phrase.', 'A **bold with *em* inside** phrase.'],
    ['the underscore forms', 'Both ___x___ and __a _b_ c__ here.', 'Both ***x*** and **a *b* c** here.']
  ])('saves %s back without gaining or losing a mark', (_name, markdown, saved) => {
    const editor = openShippedDocument()
    editor.setMarkdown(markdown, 1)
    expect(document.querySelector('#editor strong em')).not.toBeNull()
    expect(document.getElementById('editor')!.textContent).not.toMatch(/[*_]/)
    expect(editor.currentMarkdown()).toBe(saved)
  })

  // The chat's own cases for its copy of this rule (markdown-plain-text.test.ts):
  // a bold that never closes must not cost more than linear time.
  it.each([
    ['a bold over many italics', `**${'a *b* '.repeat(15_000)}`],
    ['a bold over many underscore italics', `__${'a _b_ '.repeat(15_000)}`],
    ['a star after every word', `**${'x*y '.repeat(25_000)}`],
    ['italics joined end to end', `**${'*a*'.repeat(30_000)}`],
    ['a star run', '*'.repeat(100_000)]
  ])('draws %s that never closes inside the deadline', (_name, text) => {
    const html = runInNewContext('render(text)', { render: renderInline, text }, { timeout: 250 })
    expect(typeof html).toBe('string')
  })

  it('leaves fill-in blanks, an unclosed bold and a bare star run as they were', () => {
    expect(renderInline('___ Date: ___')).toBe('___ Date: ___')
    expect(renderInline('**a')).toBe('**a')
    expect(renderInline('***')).toBe('***')
    expect(renderInline('**_x_**')).toBe('<strong><em>x</em></strong>')
    expect(renderInline('*__x__*')).toBe('<em><strong>x</strong></em>')
    // A run with a space after it opens nothing, and one with a space before
    // it closes nothing. This drew a star, bold " Date: ", a star, until
    // every emphasis had to start and end on a word (review, 2026-09-30).
    expect(renderInline('Name: *** Date: ***')).toBe('Name: *** Date: ***')
  })

  it('draws a lone star, a lone pair and a spaced pair as text', () => {
    for (const text of ['* and *', '*', '**', '* *', '** **', '_ and _', '_', '__', '_ _', '__ __', '']) {
      expect(renderInline(text)).toBe(text)
    }
    for (const text of ['**a **', '** a**', '*a *', '* a*', '__a __', '_a _']) {
      expect(renderInline(text)).toBe(text)
    }
    expect(renderInline('*a*')).toBe('<em>a</em>')
  })

  it.each([
    ['a spaced power after every word', 'x ** 2 '.repeat(20_000)],
    ['spaced bold pairs', '** '.repeat(50_000)],
    ['a bold opener before a long run of spaces', `**a${' '.repeat(100_000)}`],
    ['italics that each end on a space inside a bold', `**x ${'*a '.repeat(30_000)}`]
  ])('draws %s that never pairs inside the deadline', (_name, text) => {
    const html = runInNewContext('render(text)', { render: renderInline, text }, { timeout: 250 })
    expect(typeof html).toBe('string')
  })
})
