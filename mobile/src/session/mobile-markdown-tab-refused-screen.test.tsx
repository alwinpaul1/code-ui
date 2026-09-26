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

// Review of f9e2faf4 (2026-09-26): the disk fallback for a markdown tab the
// desktop refuses stored its reason where the screen never drew it (the
// reader printed "Read only" for any reason), so a desktop tab with unsaved
// changes showed its old disk copy with no warning; and a file the desktop
// called binary was read from disk and rendered. The real reader hook, then
// the real reader, in both themes.

type MarkdownTab = Extract<MobileSessionTab, { type: 'markdown' }>

const ok = (result: unknown): RpcSuccess => ({
  id: '1',
  ok: true,
  result,
  _meta: { runtimeId: 'runtime-1' }
})
const fail = (code: string, message: string): RpcFailure => ({
  id: '1',
  ok: false,
  error: { code, message },
  _meta: { runtimeId: 'runtime-1' }
})

function tab(isDirty: boolean): MarkdownTab {
  return {
    type: 'markdown',
    id: 'tab-md',
    relativePath: 'taco/black_text_changes_bridge.md',
    isDirty
  } as unknown as MarkdownTab
}

/** The real reader hook, then the real reader component, fed the doc the hook produced. */
async function screenAfterRead(
  replies: Record<string, RpcSuccess | RpcFailure>,
  markdownTab: MarkdownTab,
  theme: 'light' | 'dark' = 'light'
) {
  let docs = new Map<string, unknown>()
  const client = {
    sendRequest: vi.fn(async (method: string) => replies[method] ?? fail('method_not_found', method))
  }
  const scope = {
    worktreeId: 'wt-1',
    client,
    setMarkdownDocs: (next: unknown) => {
      docs =
        typeof next === 'function' ? (next as (p: typeof docs) => typeof docs)(docs) : (next as typeof docs)
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
  let screen!: ReactTestRenderer
  act(() => {
    screen = create(
      createElement(
        ThemeProvider,
        { initialPreference: theme } as ComponentProps<typeof ThemeProvider>,
        createElement(MarkdownReader, {
          documentId: markdownTab.id,
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
  return { doc, texts, shownMarkdown }
}

describe('a markdown tab the desktop refuses to read', () => {
  it.each(['light', 'dark'] as const)('says the desktop has unsaved changes when it shows the disk copy of such a tab (%s)', async (theme) => {
    const { texts, shownMarkdown } = await screenAfterRead(
      {
        'markdown.readTab': fail('runtime_error', 'tab_not_found'),
        'files.read': ok({ content: '# as saved last week\n', truncated: false })
      },
      tab(true),
      theme
    )
    expect(shownMarkdown).toContain('# as saved last week\n')
    expect(texts.join(' | ')).toMatch(/unsaved changes/i)
  })

  it.each(['light', 'dark'] as const)('puts the desktop’s reason on the screen, not only in the doc (%s)', async (theme) => {
    const { texts } = await screenAfterRead(
      {
        'markdown.readTab': fail('runtime_error', 'tab_not_found'),
        'files.read': ok({ content: '# Changes for Mahdi\n', truncated: false })
      },
      tab(false),
      theme
    )
    expect(texts.join(' | ')).toContain('tab_not_found')
  })

  it('does not render a file the desktop called binary as markdown', async () => {
    const utf16AsUtf8 = 'R\u0000E\u0000A\u0000D\u0000M\u0000E\u0000'
    const { doc, shownMarkdown, texts } = await screenAfterRead(
      {
        'markdown.readTab': fail('runtime_error', 'binary_file'),
        'files.read': ok({ content: utf16AsUtf8, truncated: false })
      },
      tab(false)
    )
    expect([doc.status, shownMarkdown]).toEqual(['error', []])
    expect(texts.join(' | ')).toContain('binary_file')
  })

  it('says a cut-short disk copy is cut short, on the screen', async () => {
    const { texts, shownMarkdown } = await screenAfterRead(
      {
        'markdown.readTab': fail('runtime_error', 'file_too_large'),
        'files.read': ok({ content: '# first 512 KB', truncated: true, byteLength: 900_000 })
      },
      tab(false)
    )
    expect(shownMarkdown).toContain('# first 512 KB')
    expect(texts.join(' | ')).toMatch(/start of the file/i)
  })

  it('names a read-only reason the desktop sends in words, not as a code', async () => {
    const { texts } = await screenAfterRead(
      { 'markdown.readTab': ok({ content: '# Preview', version: 'v1', isDirty: false, editable: false, readOnlyReason: 'unsupported_preview' }) },
      tab(false)
    )
    expect(texts.join(' | ')).toContain('a preview tab on the desktop')
    expect(texts.join(' | ')).not.toContain('unsupported_preview')
  })
})
