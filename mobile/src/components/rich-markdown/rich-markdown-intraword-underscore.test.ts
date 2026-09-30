// @vitest-environment happy-dom
// An underscore inside a word is text, not emphasis, as CommonMark and the desktop read it. The
// editor took `_case_` in `snake_case_name` for italics and saved it back as `snake*case*name`, so
// opening a file on the phone and editing anything rewrote every identifier in it (reported
// 2026-09-23; the inventory's #21137 row was one). Runs the shipped bundle, as the editor does.
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

describe('an underscore inside a word survives open-and-save', () => {
  it.each([
    ['a snake_case identifier', 'Call snake_case_name before the rest.'],
    ['a constant', 'Needs AGENT_LAUNCH_REPLAY_REQUIRED_RUNTIME_CAPABILITY on the host.'],
    ['a dunder path', 'Edit src/__init__.py and src/__main__.py.'],
    ['one identifier at the start of a line', 'snake_case_name'],
    ['two identifiers in a table cell', '| a | b |\n| --- | --- |\n| foo_bar_baz | x_y_z |'],
    ['an identifier in a list item', '- set LAYER_TYPE_HARDWARE first'],
    ['underscores between CJK characters', '你好_强调_世界'],
    ['underscores between accented letters', 'café_crème_brûlée']
  ])('%s', (_name, markdown) => {
    const editor = openShippedDocument()
    editor.setMarkdown(markdown, 1)
    expect(document.querySelector('#editor em, #editor strong')).toBeNull()
    expect(editor.currentMarkdown()).toBe(markdown)
  })

  it('still reads underscores around a word as emphasis', () => {
    const editor = openShippedDocument()
    editor.setMarkdown('Say _hello_ and __bye__ (_now_).', 1)
    expect(Array.from(document.querySelectorAll('#editor em')).map((el) => el.textContent)).toEqual([
      'hello',
      'now'
    ])
    expect(document.querySelector('#editor strong')?.textContent).toBe('bye')
  })
})

// Review, 2026-09-30: an identifier on each side of a span swallowed it.
// `_var and `code` and other_` matched the italic rule, was refused as
// intraword, and was then written out whole as text with the scan resumed
// past its end, so the code span and bold inside it never drew and their
// marks became text in the document. The chat renderer resumes one character
// after a refused opener; the editor now does the same.
describe('a span between two snake_case identifiers', () => {
  it('draws the code span or bold between them', () => {
    expect(renderInline('use my_var and `code` and other_var')).toBe(
      'use my_var and <code>code</code> and other_var'
    )
    expect(renderInline('foo_bar **bold** baz_qux')).toBe('foo_bar <strong>bold</strong> baz_qux')
    expect(renderInline('snake_case and _em_')).toBe('snake_case and <em>em</em>')
  })

  // The serializer spells an italic with stars (it always has), so `_then_`
  // saves as `*then*`; the identifiers keep their underscores.
  it.each([
    ['a code span', 'use my_var and `code` and other_var', '#editor code', 'code', null],
    ['a bold span', 'foo_bar **bold** baz_qux', '#editor strong', 'bold', null],
    ['an italic', 'Set snake_case and _then_ save.', '#editor em', 'then', 'Set snake_case and *then* save.']
  ])('saves %s beside identifiers back as it was', (_name, markdown, selector, text, saved) => {
    const editor = openShippedDocument()
    editor.setMarkdown(markdown, 1)
    expect(document.querySelector(selector)?.textContent).toBe(text)
    expect(editor.currentMarkdown()).toBe(saved ?? markdown)
  })

  it('leaves an identifier alone at the degenerate sizes', () => {
    expect(renderInline('')).toBe('')
    expect(renderInline('_')).toBe('_')
    expect(renderInline('a_b')).toBe('a_b')
    expect(renderInline('a_b_c')).toBe('a_b_c')
  })

  // A refused opener is scanned again from its next character, so the scan
  // must stay linear where refusals pile up.
  it.each([
    ['an identifier with thousands of parts', `x${'_a'.repeat(40_000)}`],
    ['a bold of italics after a letter', `a__${'_b_ '.repeat(15_000)}__`],
    ['two long underscore runs around a word', `x${'_'.repeat(20_000)}y${'_'.repeat(20_000)}z`],
    ['dunder names end to end', 'a__b__'.repeat(20_000)]
  ])('draws %s inside the deadline', (_name, text) => {
    const html = runInNewContext('render(text)', { render: renderInline, text }, { timeout: 250 })
    expect(typeof html).toBe('string')
  })
})
