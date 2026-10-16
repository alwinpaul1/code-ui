import type { ReactElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { ChatTextHoldSelectsContext, ChatTextSelectableContext } from './chat-text-selectable-context'
import { MobileMarkdown } from './MobileMarkdown'
import type * as ProseRuns from './mobile-markdown-prose-runs'

// "Fix the stuttering while scrolling through a session" (the user, 2026-10-16).
//
// The chat flips two flags at the first frame of every drag and again 250 ms after the list
// settles (use-mobile-chat-following.ts): whether text is selectable and whether a hold may start
// a selection. On Android the only thing either flag changes in a reply is one prop on the
// document's native root (`holdSelects`, SelectionCopyRootView.applyHoldSelects): the Texts stay
// selectable through a scroll (MARKDOWN_ROOT_GUARDS_HOLDS). But MobileMarkdown read both flags at
// its top, so every reply mounted in the list — the visible ones and a screen of runway either
// side — rebuilt its whole document on the JS thread twice per gesture: prose runs, every inline
// span, the native prose model and its JSON spec, pills, tables. That is JS work landing exactly
// when FlashList needs the thread to mount the rows a drag exposes.
//
// The Claude app (1.261013.20) has no such flag at all: Compose cancels a selection long press
// once the LazyColumn's drag passes the touch slop, so a scroll recomposes no transcript item.
//
// Android as Metro resolves it: markdown-selection-copy.android.tsx over markdown-selection-copy.tsx.

const counts = vi.hoisted(() => ({ documentBuilds: 0 }))

vi.mock('react-native', () => ({
  Linking: { openURL: vi.fn() },
  PixelRatio: { getFontScale: () => 1, get: () => 3 },
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
// Counts how often the document is laid out into prose runs: once per render of its body.
vi.mock('./mobile-markdown-prose-runs', async (importOriginal) => {
  const actual = await importOriginal<typeof ProseRuns>()
  return {
    ...actual,
    buildProseRuns: (...args: Parameters<typeof actual.buildProseRuns>) => {
      counts.documentBuilds += 1
      return actual.buildProseRuns(...args)
    }
  }
})

const NATIVE_ROOT = 'ViewManagerAdapter_OrcaSelectionCopy'

const REPLY = [
  '## What changed',
  '',
  'The list keeps **its rows** while you scroll, and `MobileMarkdown` draws once.',
  '',
  '- one `pill` here',
  '- and a [link](https://example.com)',
  '',
  '```ts',
  'const x = 1',
  '```',
  '',
  '| a | b |',
  '| --- | --- |',
  '| `c` | d |'
].join('\n')

const openFile = () => {}

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  counts.documentBuilds = 0
})

/** The chat list's two scroll flags, as ChatTextSelectionProvider hands them down. */
function tree(scheme: 'light' | 'dark', scrolling: boolean, content: string = REPLY): ReactElement {
  return (
    <ThemeProvider initialPreference={scheme}>
      <ChatTextSelectableContext.Provider value={!scrolling}>
        <ChatTextHoldSelectsContext.Provider value={!scrolling}>
          <MobileMarkdown content={content} identity="reply-1" onOpenFile={openFile} />
        </ChatTextHoldSelectsContext.Provider>
      </ChatTextSelectableContext.Provider>
    </ThemeProvider>
  )
}

const root = (): ReactTestInstance => renderer!.root.findByType(NATIVE_ROOT as never)
const texts = (): ReactTestInstance[] =>
  renderer!.root.findAll((node) => node.type === ('Text' as never) && node.props.selectable !== undefined)

describe.each(['light', 'dark'] as const)('scrolling the chat on Android, %s', (scheme) => {
  it('does not redraw a reply when a drag starts or the list settles, and still tells its root to refuse a hold', () => {
    act(() => {
      renderer = create(tree(scheme, false))
    })
    const builtAtMount = counts.documentBuilds
    expect(builtAtMount, 'the reply was drawn').toBeGreaterThan(0)
    expect(root().props.holdSelects).toBe(true)

    // The drag's first frame.
    act(() => renderer!.update(tree(scheme, true)))
    expect(root().props.holdSelects, 'a hold during the scroll starts no selection').toBe(false)
    expect(texts().every((text) => text.props.selectable === true), 'an open selection survives the scroll').toBe(true)
    // The list settled.
    act(() => renderer!.update(tree(scheme, false)))
    expect(root().props.holdSelects).toBe(true)

    expect(counts.documentBuilds - builtAtMount, 'document rebuilds caused by one scroll gesture').toBe(0)
  })

  it('still draws a new reply in full when its words change, and an empty one draws nothing', () => {
    act(() => {
      renderer = create(tree(scheme, false, 'one'))
    })
    const before = counts.documentBuilds
    act(() => renderer!.update(tree(scheme, false, 'one two')))
    expect(counts.documentBuilds).toBeGreaterThan(before)
    act(() => renderer!.update(tree(scheme, true, '')))
    expect(renderer!.toJSON()).toBeNull()
  })
})
