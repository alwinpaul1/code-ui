import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatView } from './MobileNativeChatView'

// The user, 2026-10-15, on 0.9.147: "while holding and copying then when i scroll the copied text
// jumps or moves or disappears if i scroll back again to there, also when scrolling the hold to
// copy triggers sometime".
//
// The chat stops a finger that lands on moving text from starting a selection: while the list
// scrolls, each reply's native root makes its Texts not long-clickable (`holdSelects` false,
// SelectionCopyRootView.applyHoldSelects; the 2026-09-12 stray-selection rule). But the flag the
// root was given was the one that keeps `selectable` on where there is no root, `textSelectable ||
// selectionLive` (use-mobile-chat-following.ts), and that one stays true for as long as ANY reply
// holds a selection. So from the first hold on, a scroll had no guard at all: the finger that
// caught a fling, or rested on a reply before it moved, started a new selection. Android holds one
// selection at a time and the chat keeps one (chat-held-selection.ts), so the new one took the
// place of the words being copied: the highlight jumped to other words, and the copied words were
// not there when the reader scrolled back.
//
// A held selection needs `selectable` left on through a scroll; it does not need holds let
// through. These tests drive the real chat view, its scroll hook, and a real reply document with
// its Android selection root, and read the root's `holdSelects` frame by frame.

vi.mock('../components/ImagePreviewModal', () => ({ ImagePreviewModal: () => null }))
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path', Defs: 'Defs', LinearGradient: 'LinearGradient', Rect: 'Rect', Stop: 'Stop' }))
vi.mock('../hooks/use-now', () => ({ useNow: () => 0 }))
vi.mock('./use-app-interruptions', () => ({ useAppInterruptions: () => undefined }))
vi.mock('react-native', () => ({
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  Animated: {
    View: 'AnimatedView',
    createAnimatedComponent: (c: unknown) => c,
    spring: () => ({ start: (done?: (result: { finished: boolean }) => void) => done?.({ finished: true }), stop: () => {} }),
    Value: class {
      interpolate() {
        return 0
      }
    },
    loop: () => ({ start: () => {}, stop: () => {} }),
    timing: () => ({}),
    sequence: () => ({})
  },
  Easing: { linear: 0, quad: 0, inOut: () => 0, out: () => 0 },
  ActivityIndicator: 'ActivityIndicator',
  Linking: { openURL: vi.fn() },
  PixelRatio: { getFontScale: () => 1 },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  useColorScheme: () => 'light',
  processColor: () => -1,
  useWindowDimensions: () => ({ height: 823, width: 384, scale: 2.8125, fontScale: 1 }),
  View: 'View'
}))
vi.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: (name: string) => (name === 'OrcaSelectionCopy' ? {} : null),
  requireNativeViewManager: (name: string) => `ViewManagerAdapter_${name}`
}))
vi.mock('../components/markdown-selection-copy', () => import('../components/markdown-selection-copy.android'))
vi.mock('../components/pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))

// The list draws every row, in the providers' tree, as FlashList's cells are.
vi.mock('@shopify/flash-list', async () => {
  const React = await import('react')
  return {
    FlashList: (props: {
      data: { id: string }[]
      renderItem: (info: { item: unknown; index: number }) => ReactNode
    }) =>
      React.createElement(
        'FlashList',
        props,
        props.data.map((item, index) => React.createElement(React.Fragment, { key: item.id }, props.renderItem({ item, index })))
      )
  }
})
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}))
vi.mock('react-native-gesture-handler', () => {
  const chain = { runOnJS: () => chain, onStart: () => chain, onUpdate: () => chain }
  return {
    Gesture: { Simultaneous: () => ({}), Native: () => ({}), Pinch: () => chain },
    GestureDetector: 'GestureDetector',
    GestureHandlerRootView: 'GestureHandlerRootView'
  }
})
vi.mock('lucide-react-native', () => ({
  ArrowDown: 'ArrowDown',
  ChevronsDownUp: 'ChevronsDownUp',
  ChevronsUpDown: 'ChevronsUpDown',
  Sparkles: 'Sparkles',
  Square: 'Square'
}))
vi.mock('./MobileBackgroundTasksSheet', () => ({ MobileBackgroundTasksSheet: 'BackgroundTasksSheet' }))
vi.mock('./MobileNativeChatRunSheet', () => ({ MobileNativeChatRunSheet: 'RunSheet' }))
vi.mock('./MobileNativeChatToolDetailSheet', () => ({ MobileNativeChatToolDetailSheet: 'ToolDetailSheet' }))
vi.mock('./MobileBackgroundShellOutputSheet', () => ({ MobileBackgroundShellOutputSheet: 'ShellOutputSheet' }))
vi.mock('../components/BottomDrawer', () => ({ BottomDrawer: 'BottomDrawer' }))
vi.mock('../components/MobileAgentIcon', () => ({ MobileAgentIcon: 'MobileAgentIcon' }))
vi.mock('./MobileNativeChatAsk', () => ({ MobileNativeChatAsk: 'ChatAsk' }))
vi.mock('./MobileNativeChatPermission', () => ({ MobileNativeChatPermission: 'ChatPermission' }))
vi.mock('./MobileNativeChatQuestion', () => ({ MobileNativeChatQuestion: 'ChatQuestion' }))
vi.mock('./MobileNativeChatVisual', () => ({ MobileNativeChatVisualProvider: ({ children }: { children?: unknown }) => children }))
vi.mock('./MobileNativeChatComposer', () => ({ MobileNativeChatComposer: 'Composer' }))
// Each row draws its reply as the chat does: a Markdown document named as MobileNativeChatMessage
// names it, inside the document's selection root.
vi.mock('./MobileNativeChatMessage', async () => {
  const React = await import('react')
  const { MobileMarkdown } = await import('../components/MobileMarkdown')
  return {
    MobileNativeChatMessage: ({ message }: { message: NativeChatMessage }) =>
      React.createElement(MobileMarkdown, {
        content: message.blocks.map((block) => (block.type === 'text' ? block.text : '')).join('\n'),
        identity: `${message.id}:0:0`
      })
  }
})

const NATIVE_ROOT = 'ViewManagerAdapter_OrcaSelectionCopy'
const FRAME_MS = 16

function reply(id: string, text: string): NativeChatMessage {
  return { id, role: 'assistant', blocks: [{ type: 'text', text }], timestamp: 0, source: 'hook' }
}

const ONE = [reply('a1', 'Yes, all of it. Doing it in batches: sheets first, then the input bar.')]
const THREE = [
  reply('a1', 'The first reply, with the words the reader copies.'),
  reply('a2', 'A second reply further down.'),
  reply('a3', 'The newest reply, where a finger lands to stop a fling.')
]

let renderer: ReactTestRenderer | null = null

function render(messages: NativeChatMessage[], scheme: 'light' | 'dark'): void {
  act(() => {
    renderer = create(
      createElement(
        ThemeProvider,
        { initialPreference: scheme },
        createElement(MobileNativeChatView, {
          messages,
          folded: messages,
          status: 'ready',
          streaming: null,
          onSend: vi.fn().mockResolvedValue(true),
          sendSurfaceId: 'tab-a',
          getSendCompletionGeneration: () => 0,
          pending: [],
          composerText: '',
          onComposerTextChange: vi.fn()
        } as Parameters<typeof MobileNativeChatView>[0])
      )
    )
  })
}

function list(): ReactTestInstance {
  return renderer!.root.find((node) => node.type === 'FlashList')
}

function roots(): ReactTestInstance[] {
  return renderer!.root.findAll((node) => node.type === (NATIVE_ROOT as never))
}

/** May a hold start a selection in every reply's Texts now (the root's `holdSelects`)? */
function holdsLetThrough(): boolean[] {
  return roots().map((root) => root.props.holdSelects !== false)
}

let y = 0
function sample(): { nativeEvent: unknown } {
  return {
    nativeEvent: {
      contentOffset: { x: 0, y },
      contentSize: { width: 400, height: 5000 },
      layoutMeasurement: { width: 400, height: 700 }
    }
  }
}

/** A hold on the first reply's words: finger down, Android's long-press, the selection's action
 *  mode opens in that document's root (SelectionCopyRootView.selectionChanged), finger up. */
function holdToSelect(): void {
  act(() => list().props.onTouchStart())
  act(() => {
    vi.advanceTimersByTime(450)
  })
  act(() =>
    roots()[roots().length - 1]!.props.onSelectionChange({
      nativeEvent: { active: true, run: 0, start: 4, end: 9, words: 'first' }
    })
  )
  act(() => list().props.onTouchEnd())
}

/** A drag and the fling after it, as Android sends them; what the roots were told each frame. */
function dragAndFling(): boolean[][] {
  const seen: boolean[][] = []
  act(() => list().props.onTouchStart())
  act(() => list().props.onTouchEnd())
  act(() => list().props.onScrollBeginDrag())
  seen.push(holdsLetThrough())
  for (let frame = 1; frame <= 6; frame += 1) {
    act(() => {
      vi.advanceTimersByTime(FRAME_MS)
    })
    y += 50
    act(() => list().props.onScroll(sample()))
    seen.push(holdsLetThrough())
  }
  act(() => list().props.onScrollEndDrag(sample()))
  act(() => list().props.onMomentumScrollBegin())
  for (let frame = 1; frame <= 10; frame += 1) {
    act(() => {
      vi.advanceTimersByTime(FRAME_MS)
    })
    y += 20 - frame
    act(() => list().props.onScroll(sample()))
    seen.push(holdsLetThrough())
  }
  return seen
}

describe('a scroll never starts a selection, while another one is held or not', () => {
  beforeEach(() => {
    y = 0
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, FRAME_MS))
    vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id))
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it.each([
    ['three replies', 'light', THREE],
    ['three replies', 'dark', THREE],
    ['one reply', 'light', ONE],
    ['one reply', 'dark', ONE]
  ] as const)('keeps a hold from selecting through every frame of a scroll with words already selected (%s, %s)', (_name, scheme, messages) => {
    render([...messages], scheme)
    expect(roots()).toHaveLength(messages.length)
    holdToSelect()
    const frames = dragAndFling()
    // No reply's Texts took a hold on any frame of the drag or the fling.
    expect(frames.every((frame) => frame.every((lets) => !lets))).toBe(true)
  })

  it('keeps the held words selectable through that scroll: nothing switches their Texts off', () => {
    render([...THREE], 'light')
    holdToSelect()
    dragAndFling()
    const texts = renderer!.root.findAll((node) => node.type === ('Text' as never) && node.props.selectable !== undefined)
    expect(texts.length).toBeGreaterThan(0)
    expect(texts.every((text) => text.props.selectable === true)).toBe(true)
  })

  it('lets a hold select again once the list is still, with the other selection still held', () => {
    render([...THREE], 'light')
    holdToSelect()
    dragAndFling()
    act(() => list().props.onMomentumScrollEnd(sample()))
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(holdsLetThrough().every(Boolean)).toBe(true)
  })

  it('keeps a hold from selecting through a scroll with nothing selected (the 2026-09-12 rule)', () => {
    render([...THREE], 'light')
    const frames = dragAndFling()
    expect(frames.every((frame) => frame.every((lets) => !lets))).toBe(true)
  })

  it('keeps the guard for the rest of a scroll in which the held selection is dismissed', () => {
    render([...THREE], 'light')
    holdToSelect()
    act(() => list().props.onTouchStart())
    act(() => list().props.onTouchEnd())
    act(() => list().props.onScrollBeginDrag())
    act(() => roots()[roots().length - 1]!.props.onSelectionChange({ nativeEvent: { active: false } }))
    expect(holdsLetThrough().every((lets) => !lets)).toBe(true)
  })
})
