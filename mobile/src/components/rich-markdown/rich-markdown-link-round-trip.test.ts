// @vitest-environment happy-dom
// Review, 2026-09-30: opening a document in the editor and saving it rewrote its links: a README
// badge saved as `[![CI](https://x/b.svg)]([https://x/r)](https://x/r))` and every bare address as
// `[address](address)`. The module-level round trips are in markdown-round-trip.test.ts; this runs
// the shipped bundle, as the editor does, so the mark that saves an address back bare is known to
// survive the document the WebView loads.
import { afterEach, describe, expect, it } from 'vitest'
import { RICH_MARKDOWN_EDITOR_DOCUMENT_SCRIPT } from '../rich-markdown-editor-document-script.generated'
import { RICH_MARKDOWN_EDITOR_MARKUP } from './document-markup'

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

describe('links and addresses in the shipped editor', () => {
  it.each([
    ['a README badge', '[![CI](https://x/b.svg)](https://x/r)'],
    ['an address inside parentheses', '(see https://x.dev/a) now'],
    ['an address before a full stop', 'see https://x.dev/a.'],
    ['a link whose address holds parentheses', '[Foo](https://en.wikipedia.org/wiki/Foo_(bar)) now'],
    ['an address in angle brackets', '<https://x.dev/a> z'],
    ['a bare address in a list item', '- see https://x.dev/a now'],
    ['an explicit link whose words are its address', '[https://x.dev/a](https://x.dev/a)']
  ])('saves %s back as it was written', (_name, markdown) => {
    const editor = openShippedDocument()
    editor.setMarkdown(markdown, 1)
    expect(editor.currentMarkdown()).toBe(markdown)
  })

  it('opens the repository from a badge and the bare address without its full stop', () => {
    const editor = openShippedDocument()
    editor.setMarkdown('[![CI](https://x/b.svg)](https://x/r) and see https://x.dev/a.', 1)
    expect(Array.from(document.querySelectorAll('#editor a')).map((link) => link.getAttribute('href'))).toEqual([
      'https://x/r',
      'https://x.dev/a'
    ])
  })
})
