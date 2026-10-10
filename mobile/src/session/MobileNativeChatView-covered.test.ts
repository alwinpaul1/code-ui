import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { MobileNativeChatView } from './MobileNativeChatView'

/**
 * The session screen's navigation focus, as react-navigation reports it to
 * `useFocusEffect`: the effect runs while the screen is focused and its cleanup
 * runs when a route is pushed over it. `silent` is a navigator that never
 * reports at all, the fail-open case vitest.setup.ts stubs for every other test.
 */
const nav = vi.hoisted(() => {
  let focused = true
  const listeners = new Set<() => void>()
  return {
    silent: false,
    isFocused: () => focused,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set(next: boolean): void {
      focused = next
      for (const listener of listeners) {
        listener()
      }
    }
  }
})

// vitest.setup.ts stubs the focus seam for every test that draws the chat; this
// file is about focus, so it runs the real seam over a stand-in navigator.
vi.unmock('./use-native-chat-screen-focus')
vi.mock('expo-router', async () => {
  const { useEffect, useSyncExternalStore } = await import('react')
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      const focused = useSyncExternalStore(nav.subscribe, nav.isFocused, nav.isFocused)
      useEffect(() => (focused && !nav.silent ? effect() : undefined), [focused, effect])
    }
  }
})

vi.mock('../components/ImagePreviewModal', () => ({ ImagePreviewModal: () => null }))
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path', Defs: 'Defs', LinearGradient: 'LinearGradient', Rect: 'Rect', Stop: 'Stop' }))
vi.mock('../hooks/use-now', () => ({ useNow: () => 0 }))
vi.mock('./use-app-interruptions', () => ({ useAppInterruptions: () => undefined }))
vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  Animated: {
    View: 'AnimatedView',
    createAnimatedComponent: (c: unknown) => c,
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
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  // A Galaxy S23's 2316px at density 2.8125.
  useWindowDimensions: () => ({ height: 823, width: 384, scale: 2.8125, fontScale: 1 }),
  View: 'View'
}))
vi.mock('@shopify/flash-list', () => ({ FlashList: 'FlashList' }))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}))
vi.mock('react-native-gesture-handler', () => {
  const chain = {
    runOnJS: () => chain,
    onStart: () => chain,
    onUpdate: () => chain
  }
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
vi.mock('./MobileBackgroundTasksSheet', () => ({
  MobileBackgroundTasksSheet: 'BackgroundTasksSheet'
}))
vi.mock('./MobileNativeChatRunSheet', () => ({ MobileNativeChatRunSheet: 'RunSheet' }))
vi.mock('./MobileNativeChatToolDetailSheet', () => ({ MobileNativeChatToolDetailSheet: 'ToolDetailSheet' }))
vi.mock('../components/BottomDrawer', () => ({ BottomDrawer: 'BottomDrawer' }))
vi.mock('./MobileNativeChatMessage', () => ({ MobileNativeChatMessage: 'ChatMessage' }))
vi.mock('../components/MobileAgentIcon', () => ({ MobileAgentIcon: 'MobileAgentIcon' }))
vi.mock('./MobileNativeChatAsk', () => ({ MobileNativeChatAsk: 'ChatAsk' }))
vi.mock('./MobileNativeChatPermission', () => ({ MobileNativeChatPermission: 'ChatPermission' }))
vi.mock('./MobileNativeChatQuestion', () => ({ MobileNativeChatQuestion: 'ChatQuestion' }))
// The inline-visual provider imports a WebView; this view's rows draw no visuals here (#26071).
vi.mock('./MobileNativeChatVisual', () => ({
  MobileNativeChatVisualProvider: ({ children }: { children?: unknown }) => children
}))
vi.mock('./MobileNativeChatComposer', async () => {
  const React = await import('react')
  return {
    MobileNativeChatComposer: (props: Record<string, unknown>) =>
      React.createElement('Composer', props)
  }
})

function turn(id: string, text: string): NativeChatMessage {
  return { id, role: 'assistant', blocks: [{ type: 'text', text }], timestamp: 0, source: 'transcript' }
}

/** What the agent had written when the reader scrolled up, mid-turn. */
const BEFORE: NativeChatMessage[] = [
  turn('m1', 'Experimental agent teams are now off.'),
  turn('m2', 'Next I am testing a fold.'),
  turn('m3', 'Folding works correctly.')
]

/** …and what it went on to write while the Files explorer covered the chat. */
const WHILE_COVERED: NativeChatMessage[] = [
  ...BEFORE,
  turn('m4', 'Now pushing the 30 MB test video to the phone to test video frames.'),
  turn('m5', 'After coming back from the file browser, the chat is blank.')
]

/**
 * The list as the phone runs it: where FlashList drew the rows (its own offset,
 * `getAbsoluteLastScrollOffset`) and where the native scroll view actually is.
 * On screen the two move together: a scroll moves the view and the scroll event
 * moves FlashList's offset. Under a pushed route only FlashList's moves (see
 * the describe below).
 */
const device = { drawnAt: 0, viewAt: 0, scrolls: [] as number[] }

const listNode = {
  getAbsoluteLastScrollOffset: () => device.drawnAt,
  scrollToOffset: ({ offset }: { offset: number }) => {
    device.scrolls.push(offset)
    device.viewAt = offset
    device.drawnAt = offset
  },
  scrollToIndex: async () => {}
}

const onLoadEarlier = vi.fn()

function chatView(
  messages: NativeChatMessage[],
  status: 'ready' | 'loading' = 'ready'
): ReturnType<typeof createElement> {
  return createElement(MobileNativeChatView, {
    messages,
    folded: messages,
    status,
    hasMore: true,
    onLoadEarlier,
    streaming: null,
    agentWorking: true,
    canStop: true,
    onSend: vi.fn().mockResolvedValue(true),
    sendSurfaceId: 'tab-a',
    getSendCompletionGeneration: () => 0,
    getComposerEditGeneration: () => 0,
    pending: [],
    composerText: '',
    onComposerTextChange: vi.fn()
  })
}

let renderer: ReactTestRenderer | null = null
// The list settles a released drag one frame later; run frames on demand.
let frames: (() => void)[] = []

beforeEach(() => {
  nav.silent = false
  nav.set(true)
  device.drawnAt = 0
  device.viewAt = 0
  device.scrolls = []
  onLoadEarlier.mockClear()
  frames = []
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => frames.push(callback))
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
    frames[handle - 1] = () => {}
  })
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.unstubAllGlobals()
})

// Async so the stored preferences the view reads on mount (Focus view) land
// inside the act, not after it.
async function show(messages: NativeChatMessage[]): Promise<void> {
  await act(async () => {
    renderer = create(chatView(messages), {
      createNodeMock: (element) => (element.type === 'FlashList' ? listNode : null)
    })
  })
}

async function rerender(messages: NativeChatMessage[], status?: 'ready' | 'loading'): Promise<void> {
  await act(async () => {
    renderer?.update(chatView(messages, status))
  })
}

function list(): ReactTestInstance {
  return renderer!.root.findByType('FlashList' as never)
}

function jumpButtonShown(): boolean {
  return renderer!.root.findAllByProps({ accessibilityLabel: 'Scroll to latest' }).length > 0
}

/** A drag up into history that comes to rest `offset` dp from the live edge. */
function scrollUpIntoHistory(offset: number): void {
  act(() => list().props.onScrollBeginDrag())
  device.viewAt = offset
  device.drawnAt = offset
  act(() =>
    list().props.onScrollEndDrag({
      nativeEvent: {
        contentOffset: { x: 0, y: offset },
        contentSize: { width: 384, height: offset + 4000 },
        layoutMeasurement: { width: 384, height: 700 }
      }
    })
  )
  const queued = frames
  frames = []
  act(() => {
    for (const frame of queued) {
      frame()
    }
  })
}

/** The one scroll event the native view sends after it moved, with 4000 dp of
 *  loaded history above the reader. */
function nativeReportsScroll(): void {
  act(() =>
    list().props.onScroll({
      nativeEvent: {
        contentOffset: { x: 0, y: device.viewAt },
        contentSize: { width: 384, height: device.viewAt + 4000 },
        layoutMeasurement: { width: 384, height: 700 }
      }
    })
  )
}

function pushFilesExplorer(): void {
  act(() => nav.set(false))
}

/** The agent writes while the chat is covered. FlashList keeps the reader's
 *  place by its own offset (`applyOffsetCorrection`); the detached native view
 *  does not follow. */
async function agentWritesWhileCovered(messages: NativeChatMessage[], grewBy: number): Promise<void> {
  await rerender(messages)
  device.drawnAt += grewBy
}

function goBackToChat(): void {
  act(() => nav.set(true))
}

// Galaxy S23 Ultra, Android 16, release build of main 6b1be352, 2026-09-27:
// scrolled up in a Claude chat while a turn ran, opened the Files explorer from
// the header, opened a file, went back twice. The list area was blank, with the
// ↓ showing; a nudge drew it, ↓ restored it.
//
// On Android FlashList keeps a reader's place through the native scroll view:
// it moves an invisible anchor row and RN's native maintainVisibleContentPosition
// scrolls the view by as much (FlashList ScrollAnchor.tsx; PlatformHelper.android
// `supportsOffsetCorrection: true`). A pushed route takes the covered screen out
// of the window (react-native-screens ScreenStack.onUpdate removes its fragment)
// and a scroll view out of the window stops that native helper
// (ReactScrollView.onDetachedFromWindow). FlashList is not told: each row the
// agent added moved its own offset on (applyOffsetCorrection →
// updateScrollOffsetWithCallback) while the view stayed put, so back on top it
// drew rows for a place the viewport was not at, and nothing scrolled to
// correct it.
describe('the chat after coming back from a screen pushed over it', () => {
  it('draws the chat again after coming back from the file browser, when the reader had scrolled up mid-turn', async () => {
    await show(BEFORE)
    scrollUpIntoHistory(1400)
    expect(jumpButtonShown()).toBe(true)

    pushFilesExplorer()
    await agentWritesWhileCovered(WHILE_COVERED, 900)
    expect(device.viewAt).not.toBe(device.drawnAt)

    goBackToChat()

    // The view is where the rows were drawn, which is also where FlashList
    // kept the reader's place; the ↓ still says what is true.
    expect(device.viewAt).toBe(device.drawnAt)
    expect(device.viewAt).toBe(2300)
    expect(jumpButtonShown()).toBe(true)

    // The scroll that move sends is not the reader coming back to the live
    // edge, nor the reader reaching the start of history.
    nativeReportsScroll()
    expect(jumpButtonShown()).toBe(true)
    expect(onLoadEarlier).not.toHaveBeenCalled()
  })

  it('draws the chat again when the finger that opened the route never reported lifting', async () => {
    // A touch end the push swallowed leaves the list thinking a finger is
    // still down; no finger can be on a covered list, so it must not stop the
    // repair.
    await show(BEFORE)
    scrollUpIntoHistory(1400)
    act(() => list().props.onTouchStart())

    pushFilesExplorer()
    await agentWritesWhileCovered(WHILE_COVERED, 900)
    goBackToChat()

    expect(device.viewAt).toBe(device.drawnAt)
  })

  it('does the same for a one-message chat, and leaves an empty one alone', async () => {
    const first = turn('m1', 'First words.')
    await show([first])
    scrollUpIntoHistory(300)
    pushFilesExplorer()
    await agentWritesWhileCovered([first, turn('m2', 'Second.')], 250)
    goBackToChat()
    expect(device.viewAt).toBe(550)
    act(() => renderer?.unmount())
    renderer = null
    device.scrolls = []

    // Nothing to scroll away from: the reader of an empty chat is at the live
    // edge, where the tail pin owns the list.
    await show([])
    pushFilesExplorer()
    await rerender([first])
    goBackToChat()
    expect(device.scrolls).toEqual([])
  })

  it('does not move a reader at the live edge', async () => {
    await show(BEFORE)
    pushFilesExplorer()
    await rerender(WHILE_COVERED)
    goBackToChat()

    expect(device.scrolls).toEqual([])
    expect(jumpButtonShown()).toBe(false)
  })

  it('moves nothing when the transcript reloaded while covered and the list is not there', async () => {
    await show(BEFORE)
    scrollUpIntoHistory(1400)
    pushFilesExplorer()
    // A reload with nothing loaded yet draws a spinner instead of the list.
    await rerender([], 'loading')

    expect(() => goBackToChat()).not.toThrow()
    expect(device.scrolls).toEqual([])
  })

  it('only a return from a covering screen moves the list', async () => {
    await show(BEFORE)
    scrollUpIntoHistory(1400)
    device.drawnAt = 1500
    await rerender(WHILE_COVERED)

    expect(device.scrolls).toEqual([])
  })

  it('never moves the list when the navigator reports no focus at all', async () => {
    // Fail-open: a list that hears nothing is left where the reader put it.
    nav.silent = true
    await show(BEFORE)
    scrollUpIntoHistory(1400)
    pushFilesExplorer()
    await agentWritesWhileCovered(WHILE_COVERED, 900)
    goBackToChat()

    expect(device.scrolls).toEqual([])
  })
})
