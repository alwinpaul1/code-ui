// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { createRichMarkdownEditorScope } from './document-scope'
import { markdownToHtml } from './markdown-to-html'
import { reflowLines } from './markdown-reflow'
import { RICH_MARKDOWN_EDITOR_MARKUP } from './document-markup'
import { RICH_MARKDOWN_EDITOR_DOCUMENT_SCRIPT } from '../rich-markdown-editor-document-script.generated'
import { escapeInjectedJavaScriptString } from '../mobile-rich-markdown-editor-script-string'

// The .md tab is a THIRD markdown renderer — the WebView rich editor — and it still painted an
// 80-column document the way the chat view used to before the marked migration. Reported from the
// device on 2026-09-15 with a screenshot of this repository's own CLAUDE.md: "too many line breaks
// for md … why dont renderer it normally like the normal md".
//
// These cases lived in mobile-rich-markdown-editor-html.test.ts, run against functions a brace
// matcher pulled out of the script strings. #21969 made the strings modules, so they run against
// the modules now, and the last one against the bundle the WebView actually loads.
function render(markdown: string): string {
  return markdownToHtml(createRichMarkdownEditorScope(), markdown)
}

describe('a hard-wrapped document opened in the .md tab', () => {
  it('reflows a wrapped paragraph instead of breaking every source line', () => {
    const html = render(
      ['A paragraph written long enough that its author', 'wrapped it at eighty columns.'].join('\n')
    )
    expect(html).not.toContain('<br />')
    expect(html).toContain(
      'A paragraph written long enough that its author wrapped it at eighty columns.'
    )
  })

  it('keeps the two breaks the author actually asked for', () => {
    expect(render('first line  \nsecond line')).toContain('<br />')
    expect(render('first line\\\nsecond line')).toContain('<br />')
  })

  it('does not read an escaped trailing backslash as a break', () => {
    // An EVEN run ends in an escaped backslash, which is text: a Windows path ending `C:\\`.
    expect(reflowLines(['path C:\\\\', 'next'])).toBe('path C:\\\\ next')
    expect(reflowLines(['odd\\', 'next'])).toBe('odd\nnext')
  })

  it('keeps a wrapped list item inside its own item', () => {
    // The symptom in the screenshot: the rest of numbered item 2 sat at the LEFT MARGIN, outside
    // the list, as its own paragraph. Third instance of this one defect — the chat parser and the
    // PR comment parser had it too.
    const html = render(
      [
        '1. **Feed it the real screen, not a paraphrase.** Terminal parsers break on',
        '   the exact bytes an agent paints: the indent, the wrap column.',
        '2. Second item.'
      ].join('\n')
    )
    expect(html).toContain('the exact bytes an agent paints')
    // One list, two items, and no stray paragraph holding the continuation.
    expect(html.match(/<li/g)?.length).toBe(2)
    expect(html).not.toMatch(/<p>\s*the exact bytes/)
  })

  it('still ends a wrapped item at a nested item, an indented rule, or a blank line', () => {
    const nested = render(['- One', '  continues', '  - Child'].join('\n'))
    expect(nested).toContain('One continues')
    expect(nested.match(/<li/g)?.length).toBe(2)
    expect(render(['- One', '', 'A following paragraph.'].join('\n'))).toContain(
      '<p>A following paragraph.</p>'
    )
    expect(render(['- One', '  ---'].join('\n'))).not.toContain('One ---')
  })

  it('leaves a fenced block’s lines exactly as written', () => {
    expect(render(['```sh', 'one', 'two', '```'].join('\n'))).toContain('one\ntwo')
  })

  it('reflows the empty and one-line degenerate paragraphs without inventing text', () => {
    expect(reflowLines([])).toBe('')
    expect(reflowLines(['only'])).toBe('only')
    expect(render('only')).toBe('<p>only</p>')
  })
})

describe('the reflow in the document the WebView loads', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, '__orcaRichMarkdown')
    document.body.innerHTML = ''
  })

  it('reflows a wrapped paragraph and a wrapped item through the injected handle', () => {
    document.body.innerHTML = RICH_MARKDOWN_EDITOR_MARKUP
    Object.assign(globalThis, {
      ReactNativeWebView: { postMessage: () => {} },
      visualViewport: {
        height: 500,
        offsetTop: 0,
        addEventListener: () => {},
        removeEventListener: () => {}
      },
      innerHeight: 800
    })
    new Function(RICH_MARKDOWN_EDITOR_DOCUMENT_SCRIPT)()
    const markdown = ['Wrapped at', 'eighty.', '', '1. Item that', '   wraps.'].join('\n')
    new Function(
      `window.__orcaRichMarkdown.setMarkdown(${escapeInjectedJavaScriptString(markdown)}, 1);\ntrue;`
    )()
    const html = document.getElementById('editor')!.innerHTML
    expect(html).toContain('<p>Wrapped at eighty.</p>')
    expect(html).toContain('Item that wraps.')
    expect(html).not.toContain('<br')
  })
})
