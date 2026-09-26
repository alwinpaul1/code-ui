import { createElement, type ComponentProps } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'dark',
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 }
}))
vi.mock('expo-file-system', () => ({ File: class {}, Paths: { cache: 'file:///cache' } }))
vi.mock('../components/MobileRichMarkdownEditor', () => ({
  MobileRichMarkdownEditor: 'MobileRichMarkdownEditor'
}))
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: 'MobileMarkdown' }))
vi.mock('lucide-react-native', () => ({ Eye: 'Eye', Pencil: 'Pencil', RefreshCw: 'RefreshCw' }))

import { Text } from 'react-native'
import type { RpcFailure, RpcSuccess } from '../transport/types'
import { MobileMarkdown } from '../components/MobileMarkdown'
import { ThemeProvider } from '../theme/theme-context'
import { MarkdownReader } from './MobileSessionMarkdownReader'
import type { MarkdownDocState, MobileSessionTab } from './mobile-session-route-types'
import { useMobileSessionDocumentReaders } from './use-mobile-session-document-readers'
import type { MobileSessionTabApplicationModel } from './use-mobile-session-tab-application'

type MarkdownTab = Extract<MobileSessionTab, { type: 'markdown' }>

const ok = (result: unknown): RpcSuccess => ({ id: '1', ok: true, result, _meta: { runtimeId: 'runtime-1' } })
const fail = (code: string, message: string): RpcFailure => ({
  id: '1',
  ok: false,
  error: { code, message },
  _meta: { runtimeId: 'runtime-1' }
})
const tab = (isDirty: boolean): MarkdownTab =>
  ({ type: 'markdown', id: 'tab-md', relativePath: 'taco/black_text_changes_bridge.md', isDirty }) as unknown as MarkdownTab

function renderReader(doc: MarkdownDocState) {
  let screen!: ReactTestRenderer
  act(() => {
    screen = create(
      createElement(
        ThemeProvider,
        { initialPreference: 'light' } as ComponentProps<typeof ThemeProvider>,
        createElement(MarkdownReader, {
          documentId: 'tab-md',
          doc,
          onRefresh: () => {},
          onChange: () => {},
          onSave: () => {},
          onCopy: () => {},
          onDiscard: () => {},
          keyboardLift: 0
        })
      )
    )
  })
  const texts = screen.root
    .findAllByType(Text)
    .flatMap((node) => [node.props.children].flat())
    .filter((child): child is string => typeof child === 'string')
  const shownMarkdown = screen.root.findAllByType(MobileMarkdown).map((node) => node.props.content)
  act(() => screen.unmount())
  return { texts: texts.join(' | '), shownMarkdown }
}

/** The real reader hook, then the real reader, fed the doc the hook produced. */
async function screenAfterRead(replies: Record<string, RpcSuccess | RpcFailure>, markdownTab: MarkdownTab) {
  let docs = new Map<string, unknown>()
  const client = { sendRequest: vi.fn(async (method: string) => replies[method] ?? fail('method_not_found', method)) }
  const scope = {
    worktreeId: 'wt-1',
    client,
    setMarkdownDocs: (next: unknown) => {
      docs = typeof next === 'function' ? (next as (p: typeof docs) => typeof docs)(docs) : (next as typeof docs)
    },
    setFileDocs: () => {},
    terminalsRef: { current: [] },
    activeSessionTabId: null,
    sessionTabs: []
  } as unknown as MobileSessionTabApplicationModel
  let readers!: ReturnType<typeof useMobileSessionDocumentReaders>
  function Probe() {
    readers = useMobileSessionDocumentReaders(scope)
    return null
  }
  let probe!: ReactTestRenderer
  act(() => {
    probe = create(createElement(Probe))
  })
  await act(async () => {
    await readers.readMarkdownTab(markdownTab)
  })
  act(() => probe.unmount())
  const doc = docs.get(markdownTab.id) as MarkdownDocState
  return { doc, ...renderReader(doc) }
}

// Second review of the file-open fix (2026-09-26), failing on 1dd65c8e: the
// read-only status line dropped the desktop's refusal on a tab with unsaved
// desktop changes, dropped the unsaved-changes warning on a cut-short copy,
// looked reasons up on a plain object (`__proto__` crashed the reader), and
// left a refused save's bare code on screen.
describe('the markdown reader\'s status line', () => {
  // The report's own refusal (tab_not_found on every Retry), on a desktop tab
  // that has unsaved changes: the screen warns about the changes but no longer
  // says why the phone could not read the desktop's copy.
  it('names the desktop’s refusal even when the desktop tab has unsaved changes', async () => {
    const { texts, shownMarkdown } = await screenAfterRead(
      {
        'markdown.readTab': fail('runtime_error', 'tab_not_found'),
        'files.read': ok({ content: '# as saved last week\n', truncated: false })
      },
      tab(true)
    )
    expect(shownMarkdown).toContain('# as saved last week\n')
    expect(texts).toMatch(/unsaved changes/i)
    expect(texts).toContain('tab_not_found')
  })

  it('names the desktop’s refusal when the disk copy is cut short', async () => {
    const { texts, shownMarkdown } = await screenAfterRead(
      {
        'markdown.readTab': fail('runtime_error', 'tab_not_found'),
        'files.read': ok({ content: '# first 512 KB', truncated: true, byteLength: 900_000 })
      },
      tab(false)
    )
    expect(shownMarkdown).toContain('# first 512 KB')
    expect(texts).toContain('tab_not_found')
  })

  // The first review's finding (an old disk copy of a tab with unsaved desktop
  // changes, drawn with no warning), still open when the copy is cut short:
  // `truncated` outranks `tabIsDirty` in buildMarkdownDiskFallbackDoc.
  it('never draws a cut-short disk copy of a tab with unsaved desktop changes without saying so', async () => {
    const { texts, shownMarkdown } = await screenAfterRead(
      {
        'markdown.readTab': fail('runtime_error', 'tab_not_found'),
        'files.read': ok({ content: '# first 512 KB, as saved last week', truncated: true, byteLength: 900_000 })
      },
      tab(true)
    )
    if (shownMarkdown.length > 0) {
      expect(texts).toMatch(/unsaved changes/i)
    }
  })

  // A plain-object lookup: a reason that names an Object.prototype member
  // resolves to that member, not to a sentence.
  const BASE = {
    status: 'ready',
    content: '# x',
    localContent: '# x',
    baseVersion: 'v',
    isDirty: false,
    editable: false,
    stale: false
  } as const
  it('does not crash the reader on a reason spelled like an Object.prototype key (__proto__)', () => {
    expect(() => renderReader({ ...BASE, readOnlyReason: '__proto__' } as MarkdownDocState)).not.toThrow()
  })

  it('still says the tab is read-only for a reason spelled like an Object.prototype key (constructor)', () => {
    expect(renderReader({ ...BASE, readOnlyReason: 'constructor' } as MarkdownDocState).texts).toMatch(/read only|constructor/i)
  })

  // Orca's bridge throws the same getReadOnlyReason codes from saveTab, and the
  // commit message says saveTab answers tab_not_found under the same upstream
  // bug. The save error sits in the same status line, still as a bare code.
  it.each(['unsupported_preview', 'tab_not_found'])('names a save the desktop refused (%s) in words, like a read', (code) => {
    const { texts } = renderReader({
      status: 'ready',
      content: '# x',
      localContent: '# x edited',
      baseVersion: 'v',
      isDirty: true,
      editable: true,
      stale: false,
      saveError: code
    } as MarkdownDocState)
    expect(texts.split(' | ')).not.toContain(code)
  })
})
