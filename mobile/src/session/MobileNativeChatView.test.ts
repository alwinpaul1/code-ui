import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  resetSessionViewPreferenceMemoryForTests,
  saveChatFocusView
} from '../storage/session-view-preferences'
import { MobileNativeChatView } from './MobileNativeChatView'

vi.mock('../components/ImagePreviewModal', () => ({ ImagePreviewModal: () => null }))
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('../hooks/use-now', () => ({ useNow: () => 0 }))
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
  // The list sizes its render-ahead window from the screen, so the stub has to
  // report one — a Galaxy S23's 2316px at density 2.8125.
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

// The sheet reaches BottomDrawer, whose styles call Platform.select — absent
// from this file's react-native mock, and irrelevant to the banner tests.
vi.mock('./MobileBackgroundTasksSheet', () => ({
  MobileBackgroundTasksSheet: 'BackgroundTasksSheet'
}))
vi.mock('./MobileNativeChatAgentRunSheet', () => ({
  MobileNativeChatAgentRunSheet: 'AgentRunSheet'
}))
// The Rewind confirm sheet reaches the same drawer; its rows are covered in
// MobileNativeChatView-rewind.test.ts.
vi.mock('../components/BottomDrawer', () => ({ BottomDrawer: 'BottomDrawer' }))

vi.mock('./MobileNativeChatMessage', () => ({ MobileNativeChatMessage: 'ChatMessage' }))
vi.mock('../components/MobileAgentIcon', () => ({ MobileAgentIcon: 'MobileAgentIcon' }))
vi.mock('./MobileNativeChatAsk', () => ({ MobileNativeChatAsk: 'ChatAsk' }))
vi.mock('./MobileNativeChatPermission', () => ({ MobileNativeChatPermission: 'ChatPermission' }))
vi.mock('./MobileNativeChatQuestion', () => ({ MobileNativeChatQuestion: 'ChatQuestion' }))

// Stand-in composer: exposes the view's `handleSend` through a pressable, which is
// the only composer behaviour these banner tests exercise.
vi.mock('./MobileNativeChatComposer', async () => {
  const React = await import('react')
  return {
    MobileNativeChatComposer: (props: {
      onSend: (text: string) => Promise<boolean>
      disabled?: boolean
      placeholder?: string
    }) =>
      React.createElement('Composer', {
        ...props,
        accessibilityLabel: 'Send message',
        onPress: () => props.onSend('hi')
      })
  }
})

type Overrides = {
  messages?: Parameters<typeof MobileNativeChatView>[0]['messages']
  folded?: Parameters<typeof MobileNativeChatView>[0]['folded']
  streaming?: string | null
  sendErrorMessage?: string | null
  onClearSendError?: () => void
  inputLockReason?: 'disconnected' | 'waiting' | null
  onSend?: (text: string) => Promise<boolean>
  pending?: Parameters<typeof MobileNativeChatView>[0]['pending']
  hasMore?: boolean
  onLoadEarlier?: () => void
  structuredActivityUi?: boolean
  turnThinking?: boolean
  agentWorking?: boolean
  canStop?: boolean
  ask?: Parameters<typeof MobileNativeChatView>[0]['ask']
  question?: Parameters<typeof MobileNativeChatView>[0]['question']
  permission?: Parameters<typeof MobileNativeChatView>[0]['permission']
  sendSurfaceId?: string
  spinner?: { verb: string; elapsed: string | null; thinking: string | null } | null
}

function assistantTurn(id: string, text: string): NativeChatMessage {
  return { id, role: 'assistant', blocks: [{ type: 'text', text }], timestamp: 0, source: 'hook' }
}

function chatViewElement(overrides: Overrides): ReturnType<typeof createElement> {
  return createElement(MobileNativeChatView, {
    messages: [],
    folded: [],
    status: 'ready',
    streaming: null,
    onSend: vi.fn().mockResolvedValue(true),
    sendSurfaceId: 'tab-a',
    getSendCompletionGeneration: () => 0,
    pending: [],
    composerText: '',
    onComposerTextChange: vi.fn(),
    ...overrides
  })
}

describe('MobileNativeChatView', () => {
  let renderer: ReactTestRenderer | null = null
  // The list settles a released drag one frame later, so momentum can cancel
  // it. Node has no rAF; run it as a macrotask the tests can flush.
  let frames: (() => void)[] = []

  beforeEach(() => {
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

  /** Run whatever the list queued for the next frame. */
  function flushFrames(): void {
    const queued = frames
    frames = []
    act(() => {
      for (const frame of queued) {
        frame()
      }
    })
  }

  async function render(overrides: Overrides = {}): Promise<void> {
    await act(async () => {
      renderer = create(chatViewElement(overrides))
    })
  }

  async function update(overrides: Overrides = {}): Promise<void> {
    await act(async () => {
      renderer?.update(chatViewElement(overrides))
    })
  }

  /** Ids of the rows the list is currently rendering. */
  function listIds(): string[] {
    const list = renderer!.root.find((node) => node.type === 'FlashList')
    return (list.props.data as { id: string }[]).map((row) => row.id)
  }

  function renderedRow(id: string): ReturnType<typeof createElement> {
    const list = renderer!.root.find((node) => node.type === 'FlashList')
    const data = list.props.data as NativeChatMessage[]
    const index = data.findIndex((row) => row.id === id)
    // A row is a fragment: an optional time divider, then the message.
    const row = list.props.renderItem({ item: data[index], index }) as {
      props: { children: [unknown, ReturnType<typeof createElement>] }
    }
    return row.props.children[1]
  }

  function banners(): ReactTestInstance[] {
    return renderer!.root.findAll((node) => node.props.accessibilityRole === 'alert')
  }

  function composer(): ReactTestInstance {
    return renderer!.root.find((node) => node.type === 'Composer')
  }

  function bannerText(): string {
    const [alert, ...rest] = banners()
    expect(rest).toHaveLength(0)
    return alert
      .findAll((node) => node.type === 'Text')
      .map((node) => node.props.children)
      .join('')
  }

  async function pressSend(): Promise<void> {
    const composer = renderer!.root.find((node) => node.type === 'Composer') as {
      props: { onPress: () => Promise<boolean> }
    }
    await act(async () => {
      await composer.props.onPress()
    })
  }

  it('attaches native gestures to the actual scroll view without replacing it on updates', async () => {
    await render()
    const scrollComponent = renderer!.root.findByType('FlashList').props.renderScrollComponent
    let scrollRenderer!: ReactTestRenderer
    await act(async () => {
      scrollRenderer = create(createElement(scrollComponent, { scrollEnabled: true }))
    })
    const detector = scrollRenderer.root.findByType('GestureDetector')
    expect(detector.children[0]).toEqual(scrollRenderer.root.findByType('ScrollView'))
    await update({ folded: [assistantTurn('a1', 'Reply')] })
    expect(renderer!.root.findByType('FlashList').props.renderScrollComponent).toBe(scrollComponent)
    act(() => scrollRenderer.unmount())
  })

  it('renders the route-reported failure verbatim', async () => {
    await render({ sendErrorMessage: 'Permission reply failed' })

    expect(banners()).toHaveLength(1)
    expect(bannerText()).toContain('Permission reply failed')
  })

  it('does not resume following during a drag near the live edge', async () => {
    await render({ folded: [assistantTurn('a1', 'Streaming reply')] })
    const list = () => renderer!.root.findByType('FlashList')
    const nearBottom = {
      nativeEvent: {
        contentOffset: { y: 20 },
        contentSize: { height: 1000 },
        layoutMeasurement: { height: 500 }
      }
    }
    act(() => list().props.onScrollBeginDrag())
    act(() => list().props.onScroll(nearBottom))
    expect(renderer!.root.findAllByProps({ accessibilityLabel: 'Scroll to latest' })).toHaveLength(
      1
    )
    // The release is not the settle: following comes back a frame later, once
    // no momentum has claimed the fling.
    act(() => list().props.onScrollEndDrag(nearBottom))
    expect(renderer!.root.findAllByProps({ accessibilityLabel: 'Scroll to latest' })).toHaveLength(
      1
    )
    flushFrames()
    expect(renderer!.root.findAllByProps({ accessibilityLabel: 'Scroll to latest' })).toHaveLength(
      0
    )
  })

  // Ported from Orca 2fc84cb49 (#20493). A flick that starts at the live edge
  // lets go while still within 40px of it; the momentum that follows carries
  // the reader up into history. Deciding at the release point handed the list
  // back to tail-follow for the length of the fling, so a token landing in
  // that window yanked the reader down again.
  it('keeps the reader in control of a fling that releases at the live edge', async () => {
    const scrollToOffset = vi.fn()
    await act(async () => {
      renderer = create(chatViewElement({ folded: [assistantTurn('a1', 'Streaming reply')] }), {
        createNodeMock: (node) =>
          node.type === 'FlashList' ? { scrollToEnd: vi.fn(), scrollToOffset } : null
      })
    })
    const list = () => renderer!.root.findByType('FlashList')
    const at = (y: number) => ({
      nativeEvent: {
        contentOffset: { y },
        contentSize: { height: 2400 },
        layoutMeasurement: { height: 400 }
      }
    })
    act(() => list().props.onScrollBeginDrag())
    act(() => list().props.onScrollEndDrag(at(20)))
    // The finger is off but the list is still flying, and the agent is still
    // writing. This growth must not pin the list to the newest row.
    await act(async () => {
      renderer!.update(
        chatViewElement({ folded: [assistantTurn('a1', 'Streaming reply, now longer')] })
      )
    })
    act(() => list().props.onContentSizeChange(400, 2600))
    expect(scrollToOffset).not.toHaveBeenCalled()
    act(() => list().props.onMomentumScrollBegin())
    flushFrames()
    // Where the fling landed decides, and it landed in history.
    act(() => list().props.onMomentumScrollEnd(at(900)))
    expect(renderer!.root.findAllByProps({ accessibilityLabel: 'Scroll to latest' })).toHaveLength(
      1
    )
  })

  it('follows again when a slow drag is let go at the live edge with no fling', async () => {
    await render({ folded: [assistantTurn('a1', 'Streaming reply')] })
    const list = () => renderer!.root.findByType('FlashList')
    const at = (y: number) => ({
      nativeEvent: {
        contentOffset: { y },
        contentSize: { height: 2400 },
        layoutMeasurement: { height: 400 }
      }
    })
    act(() => list().props.onScrollBeginDrag())
    act(() => list().props.onScrollEndDrag(at(10)))
    flushFrames()
    expect(renderer!.root.findAllByProps({ accessibilityLabel: 'Scroll to latest' })).toHaveLength(
      0
    )
  })

  it('uses history anchoring only while the reader is away from the live edge', async () => {
    await render({ folded: [assistantTurn('a1', 'Streaming reply')] })
    const list = () => renderer!.root.findByType('FlashList')
    expect(list().props.maintainVisibleContentPosition).toEqual({ disabled: true })
    act(() => list().props.onScrollBeginDrag())
    expect(list().props.maintainVisibleContentPosition).toEqual({ disabled: false })
    act(() =>
      renderer!.root.findByProps({ accessibilityLabel: 'Scroll to latest' }).props.onPress()
    )
    expect(list().props.maintainVisibleContentPosition).toEqual({ disabled: true })
  })

  it('does not treat a requested jump animation as a new reader drag', async () => {
    await render({ folded: [assistantTurn('a1', 'Reply')] })
    const list = () => renderer!.root.findByType('FlashList')
    act(() => list().props.onScrollBeginDrag())
    act(() =>
      renderer!.root.findByProps({ accessibilityLabel: 'Scroll to latest' }).props.onPress()
    )
    act(() => list().props.onMomentumScrollBegin())
    expect(list().props.maintainVisibleContentPosition).toEqual({ disabled: true })
    expect(renderer!.root.findAllByProps({ accessibilityLabel: 'Scroll to latest' })).toHaveLength(
      0
    )
  })

  it('preserves the reading position when a new message is sent from history', async () => {
    await render({ folded: [assistantTurn('a1', 'Reply')] })
    const list = () => renderer!.root.findByType('FlashList')
    act(() => list().props.onScrollBeginDrag())
    await pressSend()
    expect(list().props.maintainVisibleContentPosition).toEqual({ disabled: false })
    expect(renderer!.root.findAllByProps({ accessibilityLabel: 'Scroll to latest' })).toHaveLength(
      1
    )
  })

  it('loads older history only at the inverted history edge after the reader scrolls', async () => {
    const onLoadEarlier = vi.fn()
    await render({ folded: [assistantTurn('a1', 'Reply')], hasMore: true, onLoadEarlier })
    const list = () => renderer!.root.findByType('FlashList')
    const event = (y: number) => ({
      nativeEvent: {
        contentOffset: { y },
        contentSize: { height: 2400 },
        layoutMeasurement: { height: 400 }
      }
    })
    act(() => list().props.onScroll(event(0)))
    expect(onLoadEarlier).not.toHaveBeenCalled()
    act(() => list().props.onScrollBeginDrag())
    act(() => list().props.onScroll(event(1000)))
    expect(onLoadEarlier).not.toHaveBeenCalled()
    act(() => list().props.onScroll(event(1980)))
    expect(onLoadEarlier).toHaveBeenCalledOnce()
    expect(list().props.ListFooterComponent).not.toBeNull()
  })

  it('keeps the live edge at zero as content grows and shrinks, without moving a history reader', async () => {
    const estimatedEnd = vi.fn()
    const scrollToOffset = vi.fn()
    await act(async () => {
      renderer = create(chatViewElement({ folded: [assistantTurn('a1', 'Growing reply')] }), {
        createNodeMock: (node) =>
          node.type === 'FlashList'
            ? {
                scrollToEnd: estimatedEnd,
                scrollToOffset
              }
            : null
      })
    })
    const list = () => renderer!.root.findByType('FlashList')
    expect(list().props.inverted).toBe(true)
    // First layout of the data: pin to the live edge.
    act(() => list().props.onContentSizeChange(400, 2400))
    expect(scrollToOffset.mock.calls).toEqual([[{ offset: 0, animated: false }]])
    expect(estimatedEnd).not.toHaveBeenCalled()
    scrollToOffset.mockClear()
    // 2026-09-12: press and hold a sentence, and the transcript jumped to the
    // newest message before the copy toolbar could show. Selection handles
    // re-measure the text — a content-size change with no new data. Neither
    // that nor a fold collapsing (2200) nor a pinch (2600) may move the list.
    act(() => list().props.onContentSizeChange(400, 2200))
    act(() => list().props.onContentSizeChange(400, 2600))
    expect(scrollToOffset).not.toHaveBeenCalled()
    // New content — the reply grew — pins again, once.
    await act(async () => {
      renderer!.update(chatViewElement({ folded: [assistantTurn('a1', 'Growing reply, now longer')] }))
    })
    act(() => list().props.onContentSizeChange(400, 2700))
    act(() => list().props.onContentSizeChange(400, 2700))
    expect(scrollToOffset.mock.calls).toEqual([[{ offset: 0, animated: false }]])
    scrollToOffset.mockClear()
    // A history reader is never moved, and their arrival does not bank a jump.
    act(() => list().props.onScrollBeginDrag())
    await act(async () => {
      renderer!.update(chatViewElement({ folded: [assistantTurn('a1', 'Growing reply, longer still')] }))
    })
    act(() => list().props.onContentSizeChange(400, 2800))
    expect(scrollToOffset).not.toHaveBeenCalled()
  })

  // The dock's height is the spacer at the list's end, so a dock that grows —
  // a permission card, the key strip — leaves the newest row underneath it
  // (2026-09-13, first open of 0.5.29). That re-pin used to reach for the list
  // itself from `use-mobile-chat-dock`; it now goes through the tail-follow
  // owner, which is the only caller allowed to move the list.
  it('lifts the newest row clear of a dock that grew, through the one scroll owner', async () => {
    const scrollToOffset = vi.fn()
    await act(async () => {
      renderer = create(chatViewElement({ folded: [assistantTurn('a1', 'Reply')] }), {
        createNodeMock: (node) =>
          node.type === 'FlashList' ? { scrollToEnd: vi.fn(), scrollToOffset } : null
      })
    })
    const dock = () => renderer!.root.findByProps({ testID: 'native-chat-dock' })
    await act(async () => dock().props.onLayout({ nativeEvent: { layout: { height: 120 } } }))
    expect(scrollToOffset.mock.calls).toEqual([[{ offset: 0, animated: false }]])

    // A reader up in history keeps their place, dock or no dock.
    scrollToOffset.mockClear()
    act(() => renderer!.root.findByType('FlashList').props.onScrollBeginDrag())
    await act(async () => dock().props.onLayout({ nativeEvent: { layout: { height: 180 } } }))
    expect(scrollToOffset).not.toHaveBeenCalled()
  })

  // Ported from Orca 2fc84cb49 (#20493), whose non-inverted list has to chase a
  // tail offset that moves with the viewport. An inverted list keeps its tail
  // at offset 0 through a keyboard opening on its own, so this only re-asserts
  // it — and, like every other command, only while the reader is following.
  it('re-asserts the tail after a viewport layout only while the reader is following', async () => {
    const scrollToOffset = vi.fn()
    await act(async () => {
      renderer = create(chatViewElement({ folded: [assistantTurn('a1', 'Reply')] }), {
        createNodeMock: (node) =>
          node.type === 'FlashList' ? { scrollToEnd: vi.fn(), scrollToOffset } : null
      })
    })
    const list = () => renderer!.root.findByType('FlashList')
    act(() => list().props.onLayout({ nativeEvent: { layout: { height: 400 } } }))
    expect(scrollToOffset.mock.calls).toEqual([[{ offset: 0, animated: false }]])

    scrollToOffset.mockClear()
    act(() => list().props.onScrollBeginDrag())
    act(() => list().props.onLayout({ nativeEvent: { layout: { height: 240 } } }))
    expect(scrollToOffset).not.toHaveBeenCalled()
  })

  it('does not duplicate the route banner when the composer rejects', async () => {
    const onClearSendError = vi.fn()
    await render({
      onSend: vi.fn().mockResolvedValue(false),
      inputLockReason: 'disconnected',
      sendErrorMessage: 'Stop failed',
      onClearSendError
    })
    await pressSend()

    expect(onClearSendError).not.toHaveBeenCalled()
    expect(banners()).toHaveLength(1)
    expect(bannerText()).toContain('Stop failed')
    expect(bannerText()).toBe('Stop failed')
  })

  it('retires the route-owned banner once a send is accepted', async () => {
    const onClearSendError = vi.fn()
    await render({ sendErrorMessage: 'Stop failed', onClearSendError })

    await pressSend()

    expect(onClearSendError).toHaveBeenCalledOnce()
  })

  // The gate that decides `streaming` lives in MobileNativeChatOverlay, which
  // outlives this view; see MobileNativeChatOverlay.test.ts.
  it('appends the gated streaming bubble after the folded transcript', async () => {
    const folded = [assistantTurn('a1', 'The tests pass.')]
    await render({ folded })
    expect(listIds()).toEqual(['a1'])

    await update({ folded, streaming: 'The tests' })

    expect(listIds()).toEqual(['streaming', 'a1'])
  })

  it('renders an accepted optimistic image send without a queued state', async () => {
    await render({
      pending: [{ id: 'pending-1', text: 'look', images: ['file:///phone-photo.jpg'] }]
    })

    expect(listIds()).toEqual(['pending-1'])
    expect(renderedRow('pending-1').props).not.toHaveProperty('queued')
  })

  it('keeps a visible lock through a subscribed-end lease blip', async () => {
    vi.useFakeTimers()
    try {
      await render({ inputLockReason: 'waiting' })
      await act(async () => vi.advanceTimersByTime(600))
      expect(composer().props.disabled).toBe(true)

      await update({ inputLockReason: null })
      expect(composer().props.disabled).toBe(true)
      await act(async () => vi.advanceTimersByTime(300))
      await update({ inputLockReason: 'waiting' })
      await act(async () => vi.advanceTimersByTime(600))

      expect(composer().props.disabled).toBe(true)
      expect(composer().props.placeholder).toBe('Waiting for terminal…')
    } finally {
      vi.useRealTimers()
    }
  })

  it('unlocks after the lease stays ready', async () => {
    vi.useFakeTimers()
    try {
      await render({ inputLockReason: 'waiting' })
      await act(async () => vi.advanceTimersByTime(600))
      await update({ inputLockReason: null })
      await act(async () => vi.advanceTimersByTime(599))
      expect(composer().props.disabled).toBe(true)

      await act(async () => vi.advanceTimersByTime(1))

      expect(composer().props.disabled).toBe(false)
      expect(composer().props.placeholder).toBe('Reply, @files, /commands')
    } finally {
      vi.useRealTimers()
    }
  })

  describe('the per-turn status rows', () => {
    const userTurn = (id: string, text: string): NativeChatMessage => ({
      id,
      role: 'user',
      blocks: [{ type: 'text', text }],
      timestamp: 0,
      source: 'transcript'
    })

    function rowProps(id: string): Record<string, unknown> {
      return (renderedRow(id) as { props: Record<string, unknown> }).props
    }

    /** The status line above the composer, which says Working on the bridge lane. */
    function workingLines(): ReactTestInstance[] {
      return renderer!.root.findAll((node) => node.props?.testID === 'native-chat-status-line')
    }

    // Claude app, 2026-09-13: "Found the bug: …" kept its quote bar even though
    // the phone sent a message mid-turn — that message is an echo, not a turn.
    it('keeps a note in its quote block when only a mid-turn echo follows it', async () => {
      const tools: NativeChatMessage = {
        id: 't1',
        role: 'assistant',
        blocks: [{ type: 'tool-call', id: 'c1', name: 'Bash', input: {} }],
        timestamp: 0,
        source: 'hook'
      }
      const folded = [userTurn('u1', 'go'), assistantTurn('a1', 'Found the bug'), tools]
      await render({
        messages: folded,
        folded,
        pending: [{ id: 'pending-1', text: 'When I close the app' }]
      })
      expect(rowProps('a1').interim).toBe(true)
    })

    // Focus view (extension `claudeCode.focusView`) is a device preference the
    // Settings screen toggles; the chat that obeys it is this list, and a chat
    // left open must follow the switch when the user comes back to it.
    describe('Focus view', () => {
      beforeEach(() => resetSessionViewPreferenceMemoryForTests())
      afterEach(() => resetSessionViewPreferenceMemoryForTests())

      it('is off for every row by default', async () => {
        const folded = [userTurn('u1', 'go'), assistantTurn('a1', 'done')]
        await render({ messages: folded, folded })
        expect(rowProps('u1').focusView).toBe(false)
        expect(rowProps('a1').focusView).toBe(false)
      })

      it('reaches every row, and follows a Settings toggle without a remount', async () => {
        const folded = [userTurn('u1', 'go'), assistantTurn('a1', 'done')]
        await act(async () => {
          await saveChatFocusView(true)
        })
        await render({ messages: folded, folded })
        expect(rowProps('u1').focusView).toBe(true)
        expect(rowProps('a1').focusView).toBe(true)
        await act(async () => {
          await saveChatFocusView(false)
        })
        expect(rowProps('a1').focusView).toBe(false)
      })
    })

    it('gives the live user turn a status row and drops the three-dot indicator', async () => {
      const folded = [userTurn('u1', 'go')]
      await render({ messages: folded, folded, structuredActivityUi: true, agentWorking: true })
      const props = rowProps('u1')
      expect(props.structuredActivityUi).toBe(true)
      // Nothing reports reasoning, so the live row counts instead of guessing
      // "Thinking" from the turn having produced nothing yet (Orca #19977).
      expect(props.turnStatus).toMatchObject({ thinking: false, workedSeconds: null })
      expect(props.activeTurnIsWorking).toBe(true)
      expect(workingLines()).toHaveLength(0)
    })

    it('says Thinking only when the journal says the live turn is reasoning', async () => {
      const folded = [userTurn('u1', 'go')]
      await render({
        messages: folded,
        folded,
        structuredActivityUi: true,
        agentWorking: true,
        turnThinking: true
      })
      expect(rowProps('u1').turnStatus).toMatchObject({ thinking: true, workedSeconds: null })
    })

    it('keeps saying Thinking after the turn has already spoken', async () => {
      // The old rule stopped at the first renderable output, which is usually
      // where the reasoning actually starts.
      const folded = [userTurn('u1', 'go'), assistantTurn('a1', 'Let me check')]
      await render({
        messages: folded,
        folded,
        structuredActivityUi: true,
        agentWorking: true,
        turnThinking: true
      })
      expect(rowProps('u1').turnStatus).toMatchObject({ thinking: true, workedSeconds: null })
    })

    it('keeps the bridge lane on the status line above the composer, with no turn status', async () => {
      const folded = [userTurn('u1', 'go')]
      await render({ messages: folded, folded, agentWorking: true })
      const props = rowProps('u1')
      expect(props.structuredActivityUi).toBe(false)
      expect(props.turnStatus).toBeNull()
      expect(props.activeTurnIsWorking).toBe(false)
      expect(workingLines()).toHaveLength(1)
    })

    it('settles the finished turn to a tappable duration', async () => {
      const folded = [userTurn('u1', 'go'), assistantTurn('a1', 'done')]
      await render({ messages: folded, folded, structuredActivityUi: true, agentWorking: true })
      expect(rowProps('u1').turnStatus).toMatchObject({ thinking: false, workedSeconds: null })
      await update({ messages: folded, folded, structuredActivityUi: true, agentWorking: false })
      const settled = rowProps('u1')
      expect(settled.turnStatus).toMatchObject({ thinking: false })
      expect((settled.turnStatus as { workedSeconds: number | null }).workedSeconds).toBeTypeOf(
        'number'
      )
      expect(settled.onToggleTurn).toBeTypeOf('function')
      expect(settled.activeTurnIsWorking).toBe(false)
    })

    it('hangs no status row on an assistant row', async () => {
      const folded = [userTurn('u1', 'go'), assistantTurn('a1', 'done')]
      await render({ messages: folded, folded, structuredActivityUi: true, agentWorking: true })
      expect(rowProps('a1').turnStatus).toBeNull()
      // The assistant row still belongs to the live turn, so its tool row stays visible.
      expect(rowProps('a1').activeTurnIsWorking).toBe(true)
    })

    it('does not carry a running turn clock across chat surfaces', async () => {
      vi.useFakeTimers()
      try {
        vi.setSystemTime(1_000)
        const firstTab = [userTurn('u1', 'first')]
        await render({
          messages: firstTab,
          folded: firstTab,
          structuredActivityUi: true,
          agentWorking: true,
          sendSurfaceId: 'host\0worktree\0tab-a'
        })
        expect(rowProps('u1').turnStatus).toMatchObject({ startedAt: 1_000 })

        vi.setSystemTime(12_000)
        const secondTab = [userTurn('u2', 'second')]
        await update({
          messages: secondTab,
          folded: secondTab,
          structuredActivityUi: true,
          agentWorking: true,
          sendSurfaceId: 'host\0worktree\0tab-b'
        })

        expect(rowProps('u2').turnStatus).toMatchObject({ startedAt: 12_000 })
      } finally {
        vi.useRealTimers()
      }
    })

    // Orca #20496. While the agent waits on the user, "Working for N" under the
    // prompt is a lie the card beside it contradicts. Withheld, not settled: the
    // turn's clock keeps counting, Stop stays, and the row returns once the
    // prompt resolves.
    it.each([
      {
        label: 'structured question',
        cardType: 'ChatAsk',
        interaction: {
          ask: {
            questions: [
              {
                question: 'Pick destination',
                multiSelect: false,
                options: [{ label: 'Choice A' }, { label: 'Choice B' }]
              }
            ]
          }
        }
      },
      {
        label: 'question',
        cardType: 'ChatQuestion',
        interaction: {
          question: {
            question: 'Pick destination',
            options: ['Choice A', 'Choice B'],
            multiSelect: false,
            allowOther: true,
            optionTokens: ['choice-a', 'choice-b']
          }
        }
      },
      {
        label: 'approval',
        cardType: 'ChatPermission',
        interaction: {
          permission: {
            title: 'Allow command?',
            detail: 'pnpm test',
            options: [
              { label: 'Allow', send: 'allow' },
              { label: 'Deny', send: 'deny' }
            ]
          }
        }
      }
    ] as const)(
      'hides live turn activity for a pending $label without settling it',
      async (testCase) => {
        const folded = [userTurn('u1', 'go'), assistantTurn('a1', 'waiting for input')]
        const working = {
          messages: folded,
          folded,
          structuredActivityUi: true,
          agentWorking: true,
          canStop: true
        }
        await render({ ...working, ...testCase.interaction })

        expect(rowProps('u1').turnStatus).toBeNull()
        expect(rowProps('a1').activeTurnIsWorking).toBe(true)
        expect(
          renderer!.root.findAll((node) => node.props.accessibilityLabel === 'Stop the agent')
        ).toHaveLength(1)
        expect(renderer!.root.findAll((node) => node.type === testCase.cardType)).toHaveLength(1)

        await update(working)
        expect(rowProps('u1').turnStatus).toMatchObject({ thinking: false, workedSeconds: null })
        expect(rowProps('a1').activeTurnIsWorking).toBe(true)
      }
    )

    it('does not treat pre-user history as part of the live turn', async () => {
      const history = [
        assistantTurn('a0', 'before the first prompt'),
        userTurn('u1', 'go'),
        assistantTurn('a1', 'working')
      ]
      await render({
        messages: history,
        folded: history,
        structuredActivityUi: true,
        agentWorking: true
      })

      expect(rowProps('a0').activeTurnIsWorking).toBe(false)
      expect(rowProps('a1').activeTurnIsWorking).toBe(true)
    })
  })
})

it('does not animate a delayed scroll across the keyboard-close and queue-confirmation layouts after sending', async () => {
  vi.useFakeTimers()
  const scrollToOffset = vi.fn()
  let instance!: ReturnType<typeof create>
  try {
    await act(async () => {
      instance = create(
        chatViewElement({
          folded: [assistantTurn('a1', 'Reply')],
          onSend: vi.fn().mockResolvedValue(true)
        }),
        { createNodeMock: (node) => (node.type === 'FlashList' ? { scrollToOffset } : null) }
      )
    })
    await act(async () => instance.root.findByType('Composer').props.onPress())
    act(() => instance.root.findByType('FlashList').props.onContentSizeChange(400, 1500))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(scrollToOffset).toHaveBeenCalled()
    expect(
      scrollToOffset.mock.calls.every(
        ([options]) => options.offset === 0 && options.animated === false
      )
    ).toBe(true)
  } finally {
    await act(async () => instance?.unmount())
    vi.useRealTimers()
  }
})

it('keeps the confirmed queue inside the inverted list so it does not resize the viewport', async () => {
  let instance!: ReturnType<typeof create>
  await act(async () => {
    instance = create(chatViewElement({ queuedMessages: ['first', 'second'] }))
  })
  const queue = headerChild(instance, 'messages')
  expect(queue.props.messages).toEqual(['first', 'second'])
  expect(instance.root.findAllByType('ScrollView')).toHaveLength(0)
  await act(async () => instance.unmount())
})

/** The inverted list's header paints below the newest message; it holds the
 *  live turn status, the background-tasks row and the queue, so render it and
 *  pick the row being asserted on. */
function headerChild(
  instance: ReturnType<typeof create>,
  prop: string
): { props: Record<string, unknown> } {
  const header = instance.root.findByType('FlashList').props.ListHeaderComponent
  let rendered!: ReturnType<typeof create>
  act(() => {
    rendered = create(header)
  })
  // Deepest match: the header component itself carries a `messages` prop (the
  // transcript it counts background tasks from), and the queue row inside it
  // carries another (the queued sends). The row is the one under test.
  const match = rendered.root.findAll((node) => node.props?.[prop] !== undefined).at(-1)
  if (!match) {
    throw new Error(`no list-header child carrying "${prop}"`)
  }
  const props = match.props
  act(() => rendered.unmount())
  return { props }
}
