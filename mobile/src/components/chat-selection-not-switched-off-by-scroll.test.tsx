import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { ChatTextSelectableContext } from './chat-text-selectable-context'
import { MobileMarkdown } from './MobileMarkdown'

// The user's phone, 2026-10-14 11:08 (0.9.139, which already carried 5bccae5ce): a word held in
// a reply was selected, the reader dragged the transcript, and the selection was gone by the
// time the paragraph came back on screen.
//
// 5bccae5ce kept the chat's `selectable` on only while JavaScript had heard, through a native
// event, that a selection was open. Anything that kept that word from arriving in time (the
// event itself, a JS thread busy with a streaming turn, a Samsung build closing the toolbar's
// action mode on a scroll) left the old path in place: the scroll switched every Text's
// `selectable` off, and TextView.setTextIsSelectable(false) re-sets the text with no selection.
//
// A selection must not depend on that race. On Android, with the document's native root in the
// tree, the Texts stay selectable always, and what a scroll switches is the root's
// `holdSelects`: the root makes its Texts not long-clickable (SelectionCopyRootView.kt), which
// stops a hold STARTING a selection (the 2026-09-12 stray-selection rule) and leaves one that is
// already there alone. Without the module (an older build), the old switch is all there is.

const nativeModule = vi.hoisted(() => ({ present: true }))

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
  requireOptionalNativeModule: (name: string) => (nativeModule.present && name === 'OrcaSelectionCopy' ? {} : null),
  requireNativeViewManager: (name: string) => `ViewManagerAdapter_${name}`
}))
vi.mock('./markdown-selection-copy', () => import('./markdown-selection-copy.android'))
vi.mock('./pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))

const NATIVE_ROOT = 'ViewManagerAdapter_OrcaSelectionCopy'

const REPLY = [
  'Yes, all of it. Doing it in batches.',
  '',
  '1. **Now:** sheets. Every bottom sheet gets 44 dp top corners.',
  '2. **When the recording row lands:** input bar parity.',
  '',
  '```sh',
  'pnpm test',
  '```'
].join('\n')

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

/** The reply as the chat draws it while a scroll is (false) or is not (true) in flight. */
function show(scrolling: boolean, scheme: 'light' | 'dark' = 'light') {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <ChatTextSelectableContext.Provider value={!scrolling}>
          <MobileMarkdown content={REPLY} identity="reply" />
        </ChatTextSelectableContext.Provider>
      </ThemeProvider>
    )
  })
  const texts = renderer!.root.findAllByType('Text' as never)
  return {
    texts: texts.length,
    switchedOff: texts.filter((node) => node.props.selectable === false).length,
    selectable: texts.filter((node) => node.props.selectable === true).length,
    root: renderer!.root.findAllByType(NATIVE_ROOT as never)[0]
  }
}

describe('a scroll does not switch a reply’s selection off on Android', () => {
  it.each(['light', 'dark'] as const)(
    'keeps every Text of the reply selectable while the transcript scrolls (%s)',
    (scheme) => {
      const still = show(false, scheme)
      act(() => renderer?.unmount())
      const scrolling = show(true, scheme)
      expect(scrolling.texts).toBeGreaterThan(3)
      // The scroll switches nothing: the same Texts are selectable as at rest (a fence's line
      // numbers are never selectable, scroll or not).
      expect(scrolling.selectable).toBe(still.selectable)
      expect(scrolling.switchedOff).toBe(still.switchedOff)
      expect(scrolling.selectable).toBeGreaterThan(scrolling.switchedOff)
    }
  )

  it('tells the native root a hold may not start a selection while the transcript scrolls', () => {
    expect(show(true).root?.props.holdSelects).toBe(false)
  })

  it('lets a hold start a selection again once the transcript is still', () => {
    expect(show(false).root?.props.holdSelects).toBe(true)
  })
})

// Without the native root (iOS, the web page, a build without the module) the old switch is the
// only guard, and MobileMarkdown.selection.test.ts ('while the list is scrolling') pins it.
