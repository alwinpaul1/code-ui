import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { MobileNativeChatView } from './MobileNativeChatView'
import type { MobileNativeChatViewProps } from './mobile-native-chat-view-props'
import { resetChatDockHeightForTests } from './use-mobile-chat-dock'

/**
 * Opening a session draws its newest message at the bottom, clear of the composer, in the FIRST
 * frame, and nothing moves afterwards (the user, 2026-10-15: "the transcript only loads when i
 * open the session and it starts to populate and scroll down … see how claude mobile does that").
 *
 * The Claude app's Code session list is laid out from the bottom (newest = item 0) and its
 * content padding is the scaffold's insets, the composer included, measured in the same layout
 * pass as the rows (docs/claude-app-implementation-notes.md sections 7 and 9). Here the composer
 * dock is an absolutely positioned overlay whose height reached the list only through
 * `onLayout`, a frame after the rows were drawn: the spacer started at 0 on every open, the
 * newest row was drawn under the composer, and one layout later every row slid up by the dock's
 * height.
 */

vi.mock('../components/ImagePreviewModal', () => ({ ImagePreviewModal: () => null }))
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path', Defs: 'Defs', LinearGradient: 'LinearGradient', Rect: 'Rect', Stop: 'Stop' }))
vi.mock('../hooks/use-now', () => ({ useNow: () => 0 }))
vi.mock('./use-app-interruptions', () => ({ useAppInterruptions: () => undefined }))
vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
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
  Image: 'Image',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
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
vi.mock('./MobileBackgroundTasksSheet', () => ({ MobileBackgroundTasksSheet: 'BackgroundTasksSheet' }))
vi.mock('./MobileNativeChatRunSheet', () => ({ MobileNativeChatRunSheet: 'RunSheet' }))
vi.mock('./MobileNativeChatToolDetailSheet', () => ({ MobileNativeChatToolDetailSheet: 'ToolDetailSheet' }))
vi.mock('./MobileBackgroundShellOutputSheet', () => ({ MobileBackgroundShellOutputSheet: 'ShellOutputSheet' }))
vi.mock('../components/BottomDrawer', () => ({ BottomDrawer: 'BottomDrawer' }))
vi.mock('./MobileNativeChatMessage', () => ({ MobileNativeChatMessage: 'ChatMessage' }))
vi.mock('../components/MobileAgentIcon', () => ({ MobileAgentIcon: 'MobileAgentIcon' }))
vi.mock('./MobileNativeChatAsk', () => ({ MobileNativeChatAsk: 'ChatAsk' }))
vi.mock('./MobileNativeChatPermission', () => ({ MobileNativeChatPermission: 'ChatPermission' }))
vi.mock('./MobileNativeChatQuestion', () => ({ MobileNativeChatQuestion: 'ChatQuestion' }))
vi.mock('./MobileNativeChatVisual', () => ({ MobileNativeChatVisualProvider: ({ children }: { children?: unknown }) => children }))
vi.mock('./MobileNativeChatComposer', () => ({ MobileNativeChatComposer: 'Composer' }))

function row(id: string): NativeChatMessage {
  return { id, role: 'assistant', blocks: [{ type: 'text', text: `Reply ${id}` }], timestamp: 0, source: 'transcript' }
}

function chatViewElement(rows: NativeChatMessage[], extra: Partial<MobileNativeChatViewProps> = {}): ReturnType<typeof createElement> {
  return createElement(MobileNativeChatView, {
    messages: rows,
    folded: rows,
    status: 'ready',
    streaming: null,
    onSend: vi.fn().mockResolvedValue(true),
    sendSurfaceId: 'tab-a',
    getSendCompletionGeneration: () => 0,
    getComposerEditGeneration: () => 0,
    pending: [],
    composerText: '',
    onComposerTextChange: vi.fn(),
    ...extra
  })
}

const DOCK_HEIGHT = 148

type ScrollCall = [{ offset: number; animated?: boolean }]

describe('opening a session at its latest message', () => {
  let renderer: ReactTestRenderer | null = null
  let scrollToOffset = vi.fn<(options: ScrollCall[0]) => void>()

  beforeEach(() => {
    resetChatDockHeightForTests()
    scrollToOffset = vi.fn<(options: ScrollCall[0]) => void>()
    vi.stubGlobal('requestAnimationFrame', () => 0)
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.unstubAllGlobals()
  })

  async function open(rows: NativeChatMessage[], extra: Partial<MobileNativeChatViewProps> = {}): Promise<void> {
    await act(async () => {
      renderer = create(chatViewElement(rows, extra), {
        createNodeMock: (node) => (node.type === 'FlashList' ? { scrollToOffset, getAbsoluteLastScrollOffset: () => 0 } : null)
      })
    })
  }

  function list() {
    return renderer!.root.find((node) => (node.type as unknown) === 'FlashList')
  }

  function ids(): string[] {
    return (list().props.data as NativeChatMessage[]).map((message) => message.id)
  }

  /** The spacer at the inverted list's visual bottom: what keeps the newest row above the dock. */
  function spacerHeight(): number {
    const header = list().props.ListHeaderComponent as { props: { children: ({ props?: { testID?: string; style?: { height: number } } } | null)[] } }
    const spacer = header.props.children.find((child) => child?.props?.testID === 'native-chat-dock-spacer')
    return spacer!.props!.style!.height
  }

  async function measureDock(height: number): Promise<void> {
    const dock = renderer!.root.find((node) => node.props.testID === 'native-chat-dock' && typeof node.props.onLayout === 'function')
    await act(async () => dock.props.onLayout({ nativeEvent: { layout: { height } } }))
  }

  /** A session opened once in this run, its composer measured, then closed. */
  async function openedBefore(): Promise<void> {
    await open([row('earlier')])
    await measureDock(DOCK_HEIGHT)
    act(() => renderer!.unmount())
    renderer = null
    scrollToOffset.mockClear()
  }

  function neverAnimated(): boolean {
    return scrollToOffset.mock.calls.every(([options]) => options.offset === 0 && options.animated === false)
  }

  it('opens a session at its latest message, clear of the composer, on the first frame', async () => {
    await openedBefore()
    await open([row('a1'), row('a2'), row('a3')])
    // The first committed frame, before the dock has reported a layout: bottom-anchored, newest
    // first, and the composer's room already held.
    expect(list().props.inverted).toBe(true)
    expect(ids()).toEqual(['a3', 'a2', 'a1'])
    expect(spacerHeight()).toBe(DOCK_HEIGHT)
  })

  it('opens a session without the rows sliding once its composer is measured', async () => {
    await openedBefore()
    await open([row('a1'), row('a2')])
    const firstFrame = spacerHeight()
    await measureDock(DOCK_HEIGHT)
    expect(spacerHeight()).toBe(firstFrame)
    expect(neverAnimated()).toBe(true)
  })

  it('opens an empty session with the composer already accounted for', async () => {
    await openedBefore()
    await open([])
    expect(ids()).toEqual([])
    expect(spacerHeight()).toBe(DOCK_HEIGHT)
    await measureDock(DOCK_HEIGHT)
    expect(neverAnimated()).toBe(true)
  })

  it('opens a one-message session at that message, clear of the composer', async () => {
    await openedBefore()
    await open([row('only')])
    expect(ids()).toEqual(['only'])
    expect(spacerHeight()).toBe(DOCK_HEIGHT)
  })

  it('opens with no spacer when no composer was ever measured, then takes the first measure', async () => {
    await open([row('a1')])
    expect(spacerHeight()).toBe(0)
    await measureDock(DOCK_HEIGHT)
    expect(spacerHeight()).toBe(DOCK_HEIGHT)
  })

  it('does not carry a keyboard-raised composer into the next open', async () => {
    await open([row('a1')], { keyboardInset: 300 })
    await measureDock(DOCK_HEIGHT + 300)
    act(() => renderer!.unmount())
    renderer = null
    await open([row('a1')])
    expect(spacerHeight()).toBe(0)
  })

  it('a fresh page merges without moving the view', async () => {
    await openedBefore()
    await open([row('a2'), row('a3')])
    await measureDock(DOCK_HEIGHT)
    scrollToOffset.mockClear()
    // The network's page lands: an older row the kept copy did not hold, and a newer one.
    await act(async () => {
      renderer!.update(chatViewElement([row('a1'), row('a2'), row('a3'), row('a4')]))
    })
    act(() => list().props.onContentSizeChange(400, 1800))
    expect(ids()).toEqual(['a4', 'a3', 'a2', 'a1'])
    expect(spacerHeight()).toBe(DOCK_HEIGHT)
    // At the live edge the newest row stays at the inverted list's offset 0, never animated.
    expect(neverAnimated()).toBe(true)

    // A reader up in history is not moved by a page landing.
    scrollToOffset.mockClear()
    act(() => list().props.onScrollBeginDrag())
    await act(async () => {
      renderer!.update(chatViewElement([row('a0'), row('a1'), row('a2'), row('a3'), row('a4'), row('a5')]))
    })
    act(() => list().props.onContentSizeChange(400, 2400))
    expect(scrollToOffset).not.toHaveBeenCalled()
  })
})
