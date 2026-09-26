// Review probe (final check of 626d4bdc): the refused-save status line.
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

import { Pressable, Text } from 'react-native'
import { ThemeProvider } from '../theme/theme-context'
import { MarkdownReader } from './MobileSessionMarkdownReader'
import type { MarkdownDocState } from './mobile-session-route-types'

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
  const saveEnabled = screen.root
    .findAllByType(Pressable)
    .some(
      (node) =>
        !node.props.disabled &&
        node.findAllByType(Text).some((text) => [text.props.children].flat().includes('Save'))
    )
  act(() => screen.unmount())
  return { texts: texts.join(' | '), saveEnabled }
}

const editedDoc = (saveError: string) =>
  ({
    status: 'ready',
    content: '# x',
    localContent: '# x edited',
    baseVersion: 'v',
    isDirty: true,
    editable: true,
    stale: false,
    saveError
  }) as MarkdownDocState

// Final check of the file-open fix (2026-09-26), failing on 626d4bdc: a save
// refused as too large read "Read only" on a tab that stays editable, and a
// save refused by a desktop with no window kept its bare code.
describe('a refused save’s status line', () => {
  // Orca's saveTab throws file_too_large when the text the PHONE sent is over
  // MOBILE_MARKDOWN_EDIT_MAX_BYTES (mobile-markdown-bridge.ts saveMobileMarkdownTab).
  // The tab stays editable and Save stays enabled: trimming the text and saving
  // again works. The status line now calls it read-only.
  it('does not call an editable tab read-only when the desktop refused a save as too large', () => {
    const { texts, saveEnabled } = renderReader(editedDoc('file_too_large'))
    expect(saveEnabled).toBe(true)
    expect(texts).not.toMatch(/read only/i)
  })

  // A save sent after the desktop's window went away (macOS: window closed,
  // Orca still running) is refused with renderer_unavailable
  // (orca-runtime.ts saveMobileMarkdownTab / mobile-markdown-request-relay.ts).
  // A read refused the same way says "Editing needs Orca desktop running.";
  // the commit says saves are now worded as reads are.
  it('words a save refused by a desktop with no window as a read is worded', () => {
    const { texts } = renderReader(editedDoc('renderer_unavailable'))
    expect(texts).not.toMatch(/renderer_unavailable/)
    expect(texts).toMatch(/Orca desktop/i)
  })
})
