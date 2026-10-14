import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { ChatTextSelectionReportContext, type ChatTextSelectionReport } from './chat-text-selectable-context'
import { MarkdownSelectionRoot } from './markdown-selection-copy.android'

// The user, 2026-10-14: a selection held in a reply vanished on the first scroll of the chat.
// The chat keeps `selectable` on through a scroll only while it knows a reply holds a
// selection (chat-selection-survives-scroll.test.ts). Android tells nobody that a TextView
// holds one; the document's native root sees the selection's action mode open and close
// (SelectionCopyRootView.startActionModeForChild) and sends `onSelectionChange`. This is the
// JavaScript end of that: each document reports as one owner, and an owner that goes away
// with its selection still open is released, or every later scroll in the chat would keep
// selection on (the 2026-09-12 stray-selection buzz back for good).

const nativeModule = vi.hoisted(() => ({ present: true }))

vi.mock('react-native', () => ({
  PixelRatio: { getFontScale: () => 1 },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light',
  processColor: () => -1,
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default }
}))
vi.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: (name: string) => (nativeModule.present && name === 'OrcaSelectionCopy' ? {} : null),
  requireNativeViewManager: (name: string) => `ViewManagerAdapter_${name}`
}))

const NATIVE_ROOT = 'ViewManagerAdapter_OrcaSelectionCopy'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function mount(report: ChatTextSelectionReport | null, scheme: 'light' | 'dark' = 'light') {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <ChatTextSelectionReportContext.Provider value={report}>
          <MarkdownSelectionRoot>reply</MarkdownSelectionRoot>
        </ChatTextSelectionReportContext.Provider>
      </ThemeProvider>
    )
  })
}

/** The native root, as Fabric mounts it. */
function root() {
  return renderer!.root.findByType(NATIVE_ROOT as never)
}

/** What SelectionCopyRootView sends when a selection's action mode opens or closes. */
function nativeSelection(active: boolean) {
  act(() => {
    root().props.onSelectionChange?.({ nativeEvent: { active } })
  })
}

describe('a reply document reports whether it holds a selection', () => {
  it.each(['light', 'dark'] as const)(
    'reports the selection opening and closing, as one owner (%s)',
    (scheme) => {
      const report = vi.fn<ChatTextSelectionReport>()
      mount(report, scheme)
      nativeSelection(true)
      nativeSelection(false)
      expect(report.mock.calls.map(([, live]) => live)).toEqual([true, false])
      expect(report.mock.calls[0][0]).toBe(report.mock.calls[1][0])
    }
  )

  it('releases its selection when the reply unmounts with one still open', () => {
    const report = vi.fn<ChatTextSelectionReport>()
    mount(report)
    nativeSelection(true)
    const owner = report.mock.calls[0][0]
    act(() => renderer!.unmount())
    renderer = null
    expect(report).toHaveBeenLastCalledWith(owner, false)
  })

  it('draws the same document outside the chat, where nobody listens', () => {
    mount(null)
    expect(() => nativeSelection(true)).not.toThrow()
  })
})
