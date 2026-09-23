// @vitest-environment happy-dom
// An underscore inside a word is text, not emphasis, as CommonMark and the desktop read it. The
// editor took `_case_` in `snake_case_name` for italics and saved it back as `snake*case*name`, so
// opening a file on the phone and editing anything rewrote every identifier in it (reported
// 2026-09-23; the inventory's #21137 row was one). Runs the shipped bundle, as the editor does.
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
