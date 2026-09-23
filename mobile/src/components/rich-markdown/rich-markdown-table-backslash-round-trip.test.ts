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
  // The desktop's editor (marked) and the phone split a row the same way: a pipe is the cell's
  // when an odd run of backslashes sits right before it, so `\\|` (two) is a separator. Found by
  // the batch G confirm pass: a rule that read `\\|` as content merged a no-space header's
  // columns, and the save then deleted the second column's data.
  it.each([
    ['a no-space header ending in an escaped backslash', '|C:\\\\|D:\\\\|\n|---|---|\n|a|b|', 'b'],
    ['a regex column beside its description', '|re\\\\|note|\n|---|---|\n|\\d+|digits|', 'digits']
  ])('keeps every column of %s', (_name, markdown, secondColumnText) => {
    const editor = openShippedDocument()
    editor.setMarkdown(markdown, 1)
    expect(editor.currentMarkdown()).toContain(secondColumnText)
  })

  it('keeps the cells of a row wider than its header, rather than deleting them on save', () => {
    // An unescaped pipe inside a code span splits the cell for every GFM reader; the extra cell is
    // still the file's text (docs/upstream-port-inventory.md's #21298 row lost ~2,700 characters
    // to a phone save this way in every build before this).
    const editor = openShippedDocument()
    editor.setMarkdown('| a | b |\n| --- | --- |\n| `x | y` | z |', 1)
    expect(editor.currentMarkdown()).toBe('| a | b |  |\n| --- | --- | --- |\n| `x | y` | z |')
  })

  it('loses no cell text, whatever the cells hold, and a second save changes nothing', () => {
    // A seeded fuzz over the characters the rule turns on. What a cell shows comes back exactly,
    // except that a pipe typed after an odd run of backslashes is an escaped pipe in markdown (the
    // desktop shows `|`), so it is stored as one; saving again is byte for byte.
    let seed = 20260923
    const next = (limit: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % limit
    }
    const text = () => {
      let value = ''
      const length = 1 + next(7)
      for (let index = 0; index < length; index += 1) {
        value += ['a', '\\', '|', ' ', 'b'][next(5)]
      }
      return value.trim() || 'x'
    }
    const asStored = (value: string) =>
      value.replace(/(\\*)\|/g, (_match, run: string) => `${run.slice(run.length % 2)}|`)
    const editor = openShippedDocument()
    const failures: string[] = []
    for (let round = 0; round < 2000; round += 1) {
      editor.setMarkdown('| h1 | h2 |\n| --- | --- |\n| a | b |', 1)
      const texts = [text(), text(), text(), text()]
      document.querySelectorAll('#editor th, #editor td').forEach((cell, index) => {
        cell.textContent = texts[index]!
      })
      const saved = editor.currentMarkdown()
      editor.setMarkdown(saved, 2)
      const back = Array.from(document.querySelectorAll('#editor th, #editor td')).map(
        (cell) => cell.textContent
      )
      const again = editor.currentMarkdown()
      if (JSON.stringify(back) !== JSON.stringify(texts.map(asStored)) || again !== saved) {
        failures.push(`${JSON.stringify(texts)} -> ${JSON.stringify(saved)} -> ${JSON.stringify(back)}`)
      }
    }
    expect(failures.slice(0, 3)).toEqual([])
  })

  it('leaves a header-only table as it was', () => {
    const editor = openShippedDocument()
    editor.setMarkdown('| a | b |\n| --- | --- |', 1)
    expect(editor.currentMarkdown()).toBe('| a | b |\n| --- | --- |')
  })

  it.each([
    ['a regex in a code span (docs/upstream-port-inventory.md row #20313)', '| a | b |\n| --- | --- |\n| `/^(#{1,6})\\s+/` | x |'],
    ['a Windows path', '| path | x |\n| --- | --- |\n| C:\\Users\\me | y |'],
    ['a trailing backslash', '| a | b |\n| --- | --- |\n| x\\ | y |'],
    ['a pipe in a code span, still escaped', '| a | b |\n| --- | --- |\n| `a\\|b` | y |'],
    ['a backslash right before an escaped pipe', '| a | b |\n| --- | --- |\n| `a\\\\\\|b` | y |']
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
