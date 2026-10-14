import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import {
  ChatHeldSelectionContext,
  createChatHeldSelections,
  messageIdOfDocument,
  type ChatHeldSelections
} from './chat-held-selection'
import { MarkdownSelectionRoot } from './markdown-selection-copy.android'
import { MobileMarkdown } from './MobileMarkdown'

// The user, 2026-10-14: keep a selection however far the transcript scrolls, as the Claude app
// does. Its selection lives outside the rows (a SelectionContainer around the LazyColumn, the
// SelectionState remembered and saved: sla.java:1136, a230.java:836, ayt.java:28), so a row that
// goes away and comes back still shows it. Here the document's native root reports where its
// selection is (which Text, start, end, the words), the chat keeps that outside the row, and the
// row that draws the message again is told to put it back (`restoreSelection`, which
// SelectionCopyRootView.kt applies only where the same words still stand).

vi.mock('react-native', () => ({
  Linking: { openURL: vi.fn() },
  PixelRatio: { getFontScale: () => 1 },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light',
  processColor: () => -1,
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default }
}))
vi.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: (name: string) => (name === 'OrcaSelectionCopy' ? {} : null),
  requireNativeViewManager: (name: string) => `ViewManagerAdapter_${name}`
}))
vi.mock('./markdown-selection-copy', () => import('./markdown-selection-copy.android'))
vi.mock('./pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))

const NATIVE_ROOT = 'ViewManagerAdapter_OrcaSelectionCopy'
const SELECTED = { run: 1, start: 4, end: 21, words: 'the mapping exists' }

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function mount(store: ChatHeldSelections | null, document: string, scheme: 'light' | 'dark' = 'light') {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <ChatHeldSelectionContext.Provider value={store}>
          <MarkdownSelectionRoot document={document}>reply</MarkdownSelectionRoot>
        </ChatHeldSelectionContext.Provider>
      </ThemeProvider>
    )
  })
}

const root = () => renderer!.root.findByType(NATIVE_ROOT as never)

function nativeSelection(payload: Record<string, unknown>) {
  act(() => {
    root().props.onSelectionChange?.({ nativeEvent: payload })
  })
}

describe('a chat selection is held outside the row that draws it', () => {
  it.each(['light', 'dark'] as const)('keeps where the selection is when the native root reports it (%s)', (scheme) => {
    const store = createChatHeldSelections()
    mount(store, 'm7:0:1', scheme)
    nativeSelection({ active: true, ...SELECTED })
    expect(store.heldFor('m7:0:1')).toEqual(SELECTED)
    expect([...store.heldMessageIds()]).toEqual(['m7'])
  })

  it('puts the selection back when the row is drawn again after scrolling far away', () => {
    const store = createChatHeldSelections()
    mount(store, 'm7:0:1')
    nativeSelection({ active: true, ...SELECTED })
    // The row goes (FlashList unmounted it, or the list moved it): the selection is still meant.
    act(() => renderer!.unmount())
    renderer = null
    expect(store.heldFor('m7:0:1')).toEqual(SELECTED)
    mount(store, 'm7:0:1')
    expect(root().props.restoreSelection).toEqual(SELECTED)
    // Once the native root has it again, there is nothing left to restore.
    nativeSelection({ active: true, ...SELECTED })
    expect(root().props.restoreSelection).toBeUndefined()
  })

  it('forgets the selection the reader dismissed (a tap away, a Copy) while the row was drawn', () => {
    const store = createChatHeldSelections()
    mount(store, 'm7:0:1')
    nativeSelection({ active: true, ...SELECTED })
    nativeSelection({ active: false })
    expect(store.heldFor('m7:0:1')).toBeUndefined()
    expect(store.heldMessageIds().size).toBe(0)
  })

  it('ignores the close a row sends as it is torn down, so a scroll does not forget the selection', () => {
    const store = createChatHeldSelections()
    mount(store, 'm7:0:1')
    nativeSelection({ active: true, ...SELECTED })
    // The handler the native view still holds as it is torn down.
    const leaving = root().props.onSelectionChange as (event: { nativeEvent: object }) => void
    act(() => renderer!.unmount())
    renderer = null
    // The action mode closes when the TextView leaves the window, after React let go of the row.
    act(() => leaving({ nativeEvent: { active: false } }))
    expect(store.heldFor('m7:0:1')).toEqual(SELECTED)
  })

  it('holds one selection at a time: a new one in another reply forgets the last', () => {
    const store = createChatHeldSelections()
    mount(store, 'm7:0:1')
    nativeSelection({ active: true, ...SELECTED })
    act(() => renderer!.unmount())
    mount(store, 'm9:0:0')
    nativeSelection({ active: true, run: 0, start: 0, end: 3, words: 'now' })
    expect(store.heldFor('m7:0:1')).toBeUndefined()
    expect([...store.heldMessageIds()]).toEqual(['m9'])
  })

  it('restores nothing outside the chat, and takes no report there', () => {
    mount(null, 'm7:0:1')
    expect(root().props.restoreSelection).toBeUndefined()
    expect(() => nativeSelection({ active: true, ...SELECTED })).not.toThrow()
  })

  it('names the message of a chat document, colons in its id and all', () => {
    expect(messageIdOfDocument('m7:0:1')).toBe('m7')
    expect(messageIdOfDocument('tool:abc:2:0')).toBe('tool:abc')
    expect(messageIdOfDocument('plain')).toBe('plain')
  })

  it('names the document the chat message gives MobileMarkdown, so its root can restore', () => {
    const store = createChatHeldSelections()
    store.hold('m3:1:0', SELECTED)
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference="light">
          <ChatHeldSelectionContext.Provider value={store}>
            <MobileMarkdown content={'Yes, all of it.\n\nThe mapping exists here.'} identity="m3:1:0" />
          </ChatHeldSelectionContext.Provider>
        </ThemeProvider>
      )
    })
    expect(root().props.restoreSelection).toEqual(SELECTED)
  })
})
