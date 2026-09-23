// @vitest-environment happy-dom
// Opening and saving a file in the rich editor must leave a table cell's backslashes as written.
// Found by the batch G review (2026-09-23): upstream #22054 doubled every backslash in a cell on
// save, so any edit anywhere rewrote this repo's own docs (a `\s+` regex in a code span became
// `\\s+`, which GitHub renders differently). Runs the shipped bundle, as the editor does.
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

describe('a table cell with a backslash survives open-and-save', () => {
  it.each([
    ['a regex in a code span (docs/upstream-port-inventory.md row #20313)', '| a | b |\n| --- | --- |\n| `/^(#{1,6})\\s+/` | x |'],
    ['a Windows path', '| path | x |\n| --- | --- |\n| C:\\Users\\me | y |'],
    ['a trailing backslash', '| a | b |\n| --- | --- |\n| x\\ | y |'],
    ['a pipe in a code span, still escaped', '| a | b |\n| --- | --- |\n| `a\\|b` | y |'],
    ['a backslash right before an escaped pipe', '| a | b |\n| --- | --- |\n| `a\\\\|b` | y |']
  ])('%s', (_name, markdown) => {
    const editor = openShippedDocument()
    editor.setMarkdown(markdown, 1)
    expect(editor.currentMarkdown()).toBe(markdown)
  })

  it('shows a code cell the way the file spells it (README.md statusLine table)', () => {
    const editor = openShippedDocument()
    editor.setMarkdown('| a | b |\n| --- | --- |\n| `C:\\\\path\\\\to` | x |', 1)
    expect(document.querySelector('td code')!.textContent).toBe('C:\\\\path\\\\to')
  })
})
