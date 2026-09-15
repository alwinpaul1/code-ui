import { describe, expect, it } from 'vitest'
import {
  buildMobileRichMarkdownEditorHtml,
  escapeInjectedJavaScriptString
} from './mobile-rich-markdown-editor-html'

function editorScript(): string {
  const html = buildMobileRichMarkdownEditorHtml()
  const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1]
  expect(script).toBeTruthy()
  return script ?? ''
}

function extractBracedSource(script: string, start: number, label: string): string {
  const bodyStart = script.indexOf('{', start)
  let depth = 0
  for (let index = bodyStart; index < script.length; index += 1) {
    const char = script[index]
    if (char === '{') {
      depth += 1
    }
    if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return script.slice(start, index + 1)
      }
    }
  }
  throw new Error(`Could not extract ${label}`)
}

function extractFunctionSource(script: string, name: string): string {
  const start = script.indexOf(`function ${name}`)
  expect(start).toBeGreaterThanOrEqual(0)
  return extractBracedSource(script, start, name)
}

function extractEditorListenerSource(script: string, type: string): string {
  const start = script.indexOf(`editor.addEventListener('${type}'`)
  expect(start).toBeGreaterThanOrEqual(0)
  return `${extractBracedSource(script, start, `${type} listener`)});`
}

function runtimeMarkdownToHtml(markdown: string, editable: boolean): string {
  const script = editorScript()
  const sources = [
    'var editable = arguments[1];',
    extractFunctionSource(script, 'decodeMarkdownEntities'),
    extractFunctionSource(script, 'escapeHtml'),
    extractFunctionSource(script, 'escapeAttr'),
    extractFunctionSource(script, 'isSafeUrl'),
    extractFunctionSource(script, 'splitTableRow'),
    extractFunctionSource(script, 'isTableSeparator'),
    extractFunctionSource(script, 'renderInline'),
    extractFunctionSource(script, 'isBlockStart'),
    extractFunctionSource(script, 'indentationWidth'),
    extractFunctionSource(script, 'reflowLines'),
    extractFunctionSource(script, 'parseListLine'),
    extractFunctionSource(script, 'listKind'),
    extractFunctionSource(script, 'parseListTree'),
    extractFunctionSource(script, 'renderListItems'),
    extractFunctionSource(script, 'markdownToHtml'),
    'return markdownToHtml(arguments[0]);'
  ].join('\n')
  return new Function(sources)(markdown, editable) as string
}

function runtimeListMarkdown(): (list: unknown) => string {
  const script = editorScript()
  const sources = [
    'function listItemText(li) { return li.text; }',
    'function directNestedLists(li) { return li.nestedLists || []; }',
    extractFunctionSource(script, 'listMarkdown'),
    'return function (list) { return listMarkdown(list, 0); };'
  ].join('\n')
  return new Function(sources)() as (list: unknown) => string
}

type FakeRange = {
  commonAncestorContainer: unknown
  cloneRange: () => FakeRange
  selectNodeContents: (node: unknown) => void
  collapse: (toStart: boolean) => void
}

function createFakeRange(container: unknown): FakeRange {
  const range: FakeRange = {
    commonAncestorContainer: container,
    cloneRange: () => createFakeRange(range.commonAncestorContainer),
    selectNodeContents: (node) => {
      range.commonAncestorContainer = node
    },
    collapse: () => {}
  }
  return range
}

type FakeClickEvent = {
  clientX: number
  clientY: number
  target: { closest: (selector: string) => unknown }
  preventDefault: () => void
}

// Drives the editor's real selection and click handling against a stub DOM whose blur
// drops the selection, the way WebKit does.
function createSelectionRuntime(caretContainer: string | null) {
  const liveNodes = new Set(caretContainer ? [caretContainer] : [])
  const listeners = new Map<string, (event: FakeClickEvent) => void>()
  let focused = caretContainer != null
  let ranges: FakeRange[] = caretContainer ? [createFakeRange(caretContainer)] : []
  let caretAtPoint: string | null = null

  const editor = {
    contains: (node: unknown) => typeof node === 'string' && liveNodes.has(node),
    focus: () => {
      focused = true
      fakeDocument.activeElement = editor
    },
    blur: () => {
      focused = false
      fakeDocument.activeElement = null
      ranges = []
    },
    addEventListener: (type: string, handler: (event: FakeClickEvent) => void) => {
      listeners.set(type, handler)
    }
  }
  const fakeDocument: {
    activeElement: unknown
    createRange: () => FakeRange
    caretRangeFromPoint: () => FakeRange | null
  } = {
    activeElement: focused ? editor : null,
    createRange: () => createFakeRange('detached'),
    caretRangeFromPoint: () => (caretAtPoint ? createFakeRange(caretAtPoint) : null)
  }
  const fakeWindow = {
    getSelection: () => ({
      get rangeCount() {
        return ranges.length
      },
      getRangeAt: (index: number) => ranges[index],
      removeAllRanges: () => {
        ranges = []
      },
      addRange: (range: FakeRange) => {
        ranges = [range]
      }
    })
  }

  const script = editorScript()
  const sources = [
    'var editor = arguments[0];',
    'var document = arguments[1];',
    'var window = arguments[2];',
    'var editable = true;',
    'var savedSelectionRange = null;',
    'var selectionDroppedOnBlur = false;',
    'function post() {}',
    'function emitChange() {}',
    extractFunctionSource(script, 'focusEditor'),
    extractFunctionSource(script, 'rememberSelection'),
    extractFunctionSource(script, 'applySelectionRange'),
    extractFunctionSource(script, 'caretRangeAtPoint'),
    extractFunctionSource(script, 'dismissKeyboard'),
    extractFunctionSource(script, 'restoreSelectionOrEnd'),
    extractEditorListenerSource(script, 'click'),
    'return { dismissKeyboard: dismissKeyboard, restoreSelectionOrEnd: restoreSelectionOrEnd };'
  ].join('\n')
  const api = new Function(sources)(editor, fakeDocument, fakeWindow) as {
    dismissKeyboard: () => void
    restoreSelectionOrEnd: () => void
  }

  return {
    dismissKeyboard: api.dismissKeyboard,
    restoreSelectionOrEnd: api.restoreSelectionOrEnd,
    tapAt: (container: string, options?: { uneditableAncestor?: string }) => {
      liveNodes.add(container)
      caretAtPoint = container
      listeners.get('click')?.({
        clientX: 12,
        clientY: 34,
        target: {
          closest: (selector: string) =>
            selector === '[contenteditable="false"]' ? (options?.uneditableAncestor ?? null) : null
        },
        preventDefault: () => {}
      })
    },
    detachEditorContent: () => liveNodes.clear(),
    selectedContainer: () => {
      if (ranges.length === 0) {
        return null
      }
      const container = ranges[0].commonAncestorContainer
      return container === editor ? 'editor-end' : (container as string)
    },
    get focused() {
      return focused
    }
  }
}

describe('mobile rich markdown editor HTML', () => {
  it('builds parseable WebView JavaScript', () => {
    const script = editorScript()

    expect(() => new Function(script)).not.toThrow()
  })

  it('escapes injected markdown without reopening script tags', () => {
    const escaped = escapeInjectedJavaScriptString('</script><script>alert(1)</script>')

    expect(escaped).not.toContain('</script>')
    expect(JSON.parse(escaped.replace(/<\\\/script/gi, '</script'))).toBe(
      '</script><script>alert(1)</script>'
    )
  })

  it('renders and serializes nested bullet, ordered, and task lists with indentation intact', () => {
    const markdown = [
      '- Parent',
      '  1. Ordered child',
      '    - [x] Done task',
      '    - [ ] Open task',
      '- Sibling'
    ].join('\n')

    const html = runtimeMarkdownToHtml(markdown, true)

    expect(html).toContain(
      '<ul><li><p>Parent</p><ol start="1"><li value="1" data-list-number="1"><p>Ordered child</p>'
    )
    expect(html).toContain('<ul data-type="taskList">')
    expect(html).toContain('<li><p>Sibling</p></li></ul>')

    const listMarkdown = runtimeListMarkdown()
    const fakeList = {
      tagName: 'UL',
      getAttribute: () => null,
      children: [
        {
          tagName: 'LI',
          text: 'Parent',
          querySelector: () => null,
          nestedLists: [
            {
              tagName: 'OL',
              getAttribute: () => null,
              children: [
                {
                  tagName: 'LI',
                  text: 'Ordered child',
                  querySelector: () => null,
                  nestedLists: [
                    {
                      tagName: 'UL',
                      getAttribute: (name: string) => (name === 'data-type' ? 'taskList' : null),
                      children: [
                        {
                          tagName: 'LI',
                          text: 'Done task',
                          querySelector: () => ({ checked: true }),
                          nestedLists: []
                        },
                        {
                          tagName: 'LI',
                          text: 'Open task',
                          querySelector: () => ({ checked: false }),
                          nestedLists: []
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        },
        { tagName: 'LI', text: 'Sibling', querySelector: () => null, nestedLists: [] }
      ]
    }

    expect(listMarkdown(fakeList)).toBe(markdown)
  })

  it('renders markdown entities as characters without double-escaping them', () => {
    const html = runtimeMarkdownToHtml('R&D &amp; Sales and &lt;tag&gt;', true)

    expect(html).toContain('R&amp;D &amp; Sales and &lt;tag&gt;')
    expect(html).not.toContain('&amp;amp;')
  })

  it('preserves explicit ordered-list numbering during serialization', () => {
    const markdown = ['3. Third step', '4. Fourth step'].join('\n')
    const html = runtimeMarkdownToHtml(markdown, true)

    expect(html).toContain('<ol start="3">')
    expect(html).toContain('data-list-number="3"')

    const listMarkdown = runtimeListMarkdown()
    const fakeList = {
      tagName: 'OL',
      getAttribute: () => null,
      children: [
        {
          tagName: 'LI',
          text: 'Third step',
          getAttribute: (name: string) => (name === 'data-list-number' ? '3' : null),
          querySelector: () => null,
          nestedLists: []
        },
        {
          tagName: 'LI',
          text: 'Fourth step',
          getAttribute: (name: string) => (name === 'data-list-number' ? '4' : null),
          querySelector: () => null,
          nestedLists: []
        }
      ]
    }

    expect(listMarkdown(fakeList)).toBe(markdown)
  })

  it('serializes ordered lists from parent start when item metadata is missing', () => {
    const listMarkdown = runtimeListMarkdown()
    const fakeList = {
      tagName: 'OL',
      getAttribute: (name: string) => (name === 'start' ? '8' : null),
      children: [
        {
          tagName: 'LI',
          text: 'Pasted step',
          getAttribute: () => null,
          querySelector: () => null,
          nestedLists: []
        },
        {
          tagName: 'LI',
          text: 'Inserted step',
          getAttribute: () => null,
          querySelector: () => null,
          nestedLists: []
        }
      ]
    }

    expect(listMarkdown(fakeList)).toBe(['8. Pasted step', '9. Inserted step'].join('\n'))
  })

  it('renders task checkboxes as disabled while read-only and guards mutation emitters', () => {
    const html = runtimeMarkdownToHtml('- [ ] Read-only task', false)
    const script = editorScript()

    expect(html).toContain('type="checkbox" disabled')
    expect(extractFunctionSource(script, 'emitChange')).toContain('suppressInput || !editable')
    expect(extractFunctionSource(script, 'setEditable')).toContain('syncTaskCheckboxesDisabled')
  })

  it('carries document generations through content replacement and change messages', () => {
    const script = editorScript()
    const setMarkdown = extractFunctionSource(script, 'setMarkdown')
    const emitChange = extractFunctionSource(script, 'emitChange')

    expect(setMarkdown).toContain('window.clearTimeout(inputTimer)')
    expect(setMarkdown).toContain('documentGeneration = Number(generation) || 0')
    expect(emitChange).toContain('var pendingGeneration = documentGeneration')
    expect(emitChange).not.toContain('window.setTimeout')
    expect(emitChange).toContain('generation: pendingGeneration')
  })

  it('exposes a keyboard dismissal command that blurs WebView focus', () => {
    const script = editorScript()
    const dismissKeyboard = extractFunctionSource(script, 'dismissKeyboard')

    expect(dismissKeyboard).toContain('rememberSelection()')
    expect(dismissKeyboard).toContain('document.activeElement.blur()')
    expect(dismissKeyboard).toContain('editor.blur()')
    expect(script).toContain('dismissKeyboard: dismissKeyboard')
  })

  it('reclaims editor focus at the tapped caret after keyboard dismissal', () => {
    const runtime = createSelectionRuntime('paragraph-3')

    runtime.dismissKeyboard()
    runtime.tapAt('paragraph-7')

    expect(runtime.focused).toBe(true)
    expect(runtime.selectedContainer()).toBe('paragraph-7')
  })

  it('leaves task-list label taps to the checkbox instead of refocusing the editor', () => {
    const runtime = createSelectionRuntime('paragraph-3')

    runtime.dismissKeyboard()
    runtime.tapAt('paragraph-7', { uneditableAncestor: 'task-label' })

    expect(runtime.focused).toBe(false)
    expect(runtime.selectedContainer()).toBe(null)
  })

  it('restores the pre-dismissal caret so commands do not insert at the document end', () => {
    const runtime = createSelectionRuntime('paragraph-3')

    runtime.dismissKeyboard()
    expect(runtime.selectedContainer()).toBe(null)

    runtime.restoreSelectionOrEnd()

    expect(runtime.selectedContainer()).toBe('paragraph-3')
    expect(runtime.focused).toBe(true)
  })

  it('falls back to the document end when no caret was ever placed', () => {
    const runtime = createSelectionRuntime(null)

    runtime.restoreSelectionOrEnd()

    expect(runtime.selectedContainer()).toBe('editor-end')
  })

  it('drops a remembered caret whose nodes left the document', () => {
    const runtime = createSelectionRuntime('paragraph-3')

    runtime.dismissKeyboard()
    runtime.detachEditorContent()
    runtime.restoreSelectionOrEnd()

    expect(runtime.selectedContainer()).toBe('editor-end')
  })
})

// The .md tab is a THIRD markdown renderer — the WebView rich editor — and it
// still painted an 80-column document the way the chat view used to before the
// marked migration. Reported from the device on 2026-09-15 with a screenshot of
// this repository's own CLAUDE.md: "too many line breaks for md … why dont
// renderer it normally like the normal md".
describe('a hard-wrapped document opened in the .md tab', () => {
  it('reflows a wrapped paragraph instead of breaking every source line', () => {
    const html = runtimeMarkdownToHtml(
      ['A paragraph written long enough that its author', 'wrapped it at eighty columns.'].join(
        '\n'
      ),
      true
    )
    expect(html).not.toContain('<br />')
    expect(html).toContain('A paragraph written long enough that its author wrapped it at eighty columns.')
  })

  it('keeps the two breaks the author actually asked for', () => {
    const twoSpaces = runtimeMarkdownToHtml('first line  \nsecond line', true)
    expect(twoSpaces).toContain('<br />')
    const backslash = runtimeMarkdownToHtml('first line\\\nsecond line', true)
    expect(backslash).toContain('<br />')
  })

  it('keeps a wrapped list item inside its own item', () => {
    // The symptom in the screenshot: the rest of numbered item 2 sat at the LEFT
    // MARGIN, outside the list, as its own paragraph. Third instance of this one
    // defect — the chat parser and the PR comment parser had it too.
    const html = runtimeMarkdownToHtml(
      [
        '1. **Feed it the real screen, not a paraphrase.** Terminal parsers break on',
        '   the exact bytes an agent paints: the indent, the wrap column.',
        '2. Second item.'
      ].join('\n'),
      true
    )
    expect(html).toContain('the exact bytes an agent paints')
    // One list, two items, and no stray paragraph holding the continuation.
    expect(html.match(/<li/g)?.length).toBe(2)
    expect(html).not.toMatch(/<p>\s*the exact bytes/)
  })

  it('still ends the list at a blank line', () => {
    const html = runtimeMarkdownToHtml(['- One', '', 'A following paragraph.'].join('\n'), true)
    expect(html.match(/<li/g)?.length).toBe(1)
    expect(html).toContain('<p>A following paragraph.</p>')
  })

  it('leaves a fenced block’s lines exactly as written', () => {
    const html = runtimeMarkdownToHtml(['```sh', 'one', 'two', '```'].join('\n'), true)
    expect(html).toContain('one\ntwo')
  })
})

// The .md tab rendered EMPTY — just "Start writing..." over an editor with no
// document (device screenshot, 2026-09-15). The script parts are concatenated
// fragments, not whole files: `-body-primary` ENDS MID-FUNCTION and
// `-body-secondary` opens with the `}` that closes it. A new part spliced into
// that seam made the whole script a syntax error, the WebView threw on load,
// and the editor came up blank.
//
// Every other test here pulls ONE function out of the script with a brace
// matcher and evaluates it alone, so all of them passed against a script that
// could never run. This is the check that covers what those do not.
describe('the assembled editor script', () => {
  it('parses as JavaScript', () => {
    const html = buildMobileRichMarkdownEditorHtml()
    const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1] ?? ''
    expect(script.length).toBeGreaterThan(1000)
    expect(() => new Function(script)).not.toThrow()
  })

  // Syntax alone does NOT catch this. Splicing a part into the middle of a
  // function still PARSES — the new function simply becomes a nested
  // declaration inside the one it landed in, and the trailing `}` closes the
  // outer one. It is then out of scope for every caller, so the first call
  // throws at runtime and the editor renders nothing. That is exactly what
  // shipped. The invariant is DEPTH: every markdown helper is declared at the
  // same level as the others.
  it('declares every markdown helper at the same scope', () => {
    const html = buildMobileRichMarkdownEditorHtml()
    const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1] ?? ''
    // Comments FIRST. A quote inside a comment ("the repo's CLAUDE.md") makes
    // the string matcher run on past it and eat the code that follows — which
    // it did here, and the test reported the function missing rather than
    // misplaced. CLAUDE.md names this: strip comments before matching.
    const source = script
      .replace(/\/\/[^\n]*/g, '')
      .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''")
    const depths = new Map()
    let depth = 0
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index]
      if (char === '{') {
        depth += 1
      } else if (char === '}') {
        depth -= 1
      } else {
        const name = /^function ([A-Za-z0-9_]+)/.exec(source.slice(index, index + 64))
        if (name && (index === 0 || !/[A-Za-z0-9_.]/.test(source[index - 1] ?? ''))) {
          depths.set(name[1], depth)
        }
      }
    }
    const helpers = [
      'reflowLines',
      'indentationWidth',
      'parseListLine',
      'parseListTree',
      'renderListItems',
      'markdownToHtml',
      'isBlockStart'
    ]
    for (const helper of helpers) {
      expect(depths.has(helper), `${helper} is declared`).toBe(true)
    }
    const levels = new Set(helpers.map((helper) => depths.get(helper)))
    expect(levels.size, `helpers sit at depths ${[...levels].join(', ')}`).toBe(1)
  })
})
