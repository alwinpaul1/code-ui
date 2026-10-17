import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { MobileNativeChatView } from './MobileNativeChatView'
import type { MobileNativeChatViewProps } from './mobile-native-chat-view-props'
import { ConsecutiveNumbers } from '@shopify/flash-list/dist/recyclerview/helpers/ConsecutiveNumbers'
import { RenderStackManager } from '@shopify/flash-list/dist/recyclerview/RenderStackManager'
import { chatRowItemType } from './mobile-native-chat-list-extra-data'

/**
 * "Fix the stuttering while scrolling through a session; see how Claude does that" (the user,
 * 2026-10-16).
 *
 * FlashList 2.3.2 draws each row through a memoised ViewHolder that re-renders the row when the
 * list's `renderItem` changes identity (ViewHolder.tsx, the memo's `prevProps.renderItem ===
 * nextProps.renderItem`). The chat view re-renders when a drag starts (text stops being
 * selectable, the reader detaches from the tail), when the newest row passes 48 dp from rest (the
 * jump control) and when the list settles. `renderItem` listed the turn disclosure's whole result
 * as a dependency, and that object is new on every render, so each of those moments called
 * `renderItem` again for every row mounted in the list, the runway either side included.
 *
 * The Claude app (1.261013.20) keys its transcript LazyColumn by message id and gives every item a
 * content type from the event's own kind (ay8.java:12276, the `d6j.g(size, key, contentType, …)`
 * call; key `no.java:100-108`, `fallback_<i>` when an id is missing; content type
 * `sp7.java:61-71`, `d5v.getType()`: "focus_fold" jkf.java:46, "env_log" m1m.java:35,
 * "context_compacted_boundary" t7a.java:38, and so on). Compose reuses a slot only for an item of
 * the same type, and a scroll recomposes nothing.
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
    Gesture: { Simultaneous: () => ({}), Native: () => { const native: Record<string, () => unknown> = { shouldCancelWhenOutside: () => native, runOnJS: () => native, onFinalize: () => native }; return native }, Pinch: () => chain },
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

function row(id: string, role: NativeChatMessage['role'] = 'assistant'): NativeChatMessage {
  return { id, role, blocks: [{ type: 'text', text: `${role} ${id}` }], timestamp: 0, source: 'transcript' }
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

/** A scroll sample of the inverted list: `offset` dp up from the newest row. */
function sample(offset: number) {
  return {
    nativeEvent: {
      contentOffset: { x: 0, y: offset },
      contentSize: { width: 384, height: 6000 },
      layoutMeasurement: { width: 384, height: 700 }
    }
  }
}

describe('scrolling through a session redraws no row', () => {
  let renderer: ReactTestRenderer | null = null
  // Stable across renders, as the overlay hands them down.
  const extra: Partial<MobileNativeChatViewProps> = {}

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 16))
    vi.stubGlobal('cancelAnimationFrame', (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle))
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function open(rows: NativeChatMessage[]): void {
    const element = chatViewElement(rows, extra)
    act(() => {
      renderer = create(element, {
        createNodeMock: (node) =>
          node.type === 'FlashList' ? { scrollToOffset: () => {}, getAbsoluteLastScrollOffset: () => 0 } : null
      })
    })
  }

  const list = () => renderer!.root.find((node) => (node.type as unknown) === 'FlashList')

  /** What FlashList 2.3.2's ViewHolder memo compares for every row, besides the row's own item and
   *  layout: a change in any of these redraws every mounted row. */
  const rowInputs = () => {
    const { renderItem, extraData, getItemType } = list().props as Record<string, unknown>
    return { renderItem, extraData, getItemType }
  }

  /** A drag up into history, a fling, and the list coming to rest. */
  function scrollGesture(): void {
    act(() => list().props.onScrollBeginDrag())
    act(() => list().props.onScroll(sample(20)))
    act(() => list().props.onScroll(sample(400)))
    act(() => list().props.onScrollEndDrag(sample(400)))
    act(() => list().props.onMomentumScrollBegin())
    act(() => list().props.onScroll(sample(900)))
    act(() => list().props.onMomentumScrollEnd(sample(900)))
    act(() => {
      vi.advanceTimersByTime(1000)
    })
  }

  it.each([
    ['a long session', Array.from({ length: 30 }, (_, index) => row(`m${index}`, index % 2 ? 'assistant' : 'user'))],
    ['a one-message session', [row('only')]],
    ['an empty session', []]
  ])('keeps every row as it was drawn through a drag, a fling and the list settling: %s', (_, rows) => {
    open(rows)
    const before = rowInputs()
    // The gesture does reach the view: the reader leaves the tail, and the jump control rises.
    scrollGesture()
    expect(list().props.maintainVisibleContentPosition, 'the reader is up in history').toEqual({ disabled: false })
    const after = rowInputs()
    expect(after.renderItem === before.renderItem, 'renderItem kept its identity').toBe(true)
    expect(after.extraData === before.extraData, 'extraData kept its identity').toBe(true)
    expect(after.getItemType === before.getItemType, 'getItemType kept its identity').toBe(true)
  })

  it('still draws rows again when the transcript itself changes', () => {
    const rows = [row('a1', 'user'), row('a2')]
    open(rows)
    const before = rowInputs().renderItem
    act(() => renderer!.update(chatViewElement([...rows, row('a3', 'user')], extra)))
    // A new row shifts every inverted index the turn disclosure reads, so the rows must hear it.
    expect(rowInputs().renderItem === before).toBe(false)
  })
})

type Row = { id: string; role: NativeChatMessage['role'] }

/** Every pair of (row key, message) FlashList's own recycler draws while `windows` scroll by. */
function recycle(data: Row[], windows: Array<[number, number]>, held: ReadonlySet<string> = new Set()): Map<string, Set<string>> {
  const stack = new RenderStackManager()
  const drew = new Map<string, Set<string>>()
  for (const [first, last] of windows) {
    stack.sync(
      (index) => data[index]!.id,
      (index) => chatRowItemType(data[index]!, held),
      new ConsecutiveNumbers(first, last),
      data.length
    )
    for (const [key, info] of stack.getRenderStack()) {
      const seen = drew.get(key) ?? new Set<string>()
      seen.add(info.stableId)
      drew.set(key, seen)
    }
  }
  return drew
}

function window(from: number, to: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let first = from; first <= to; first++) {
    out.push([first, first + 3])
  }
  return out
}

describe('a recycled row only ever draws a message of its own kind, as the Claude app types its items', () => {
  const kinds: NativeChatMessage['role'][] = ['user', 'assistant', 'assistant', 'tool', 'assistant', 'reasoning']
  const transcript: Row[] = Array.from({ length: 60 }, (_, index) => ({ id: `m${index}`, role: kinds[index % kinds.length]! }))
  const roleOf = new Map(transcript.map((message) => [message.id, message.role]))

  it('never hands a reply\'s row to a prompt or a tool call, which would rebuild it from nothing', () => {
    const drew = recycle(transcript, window(0, 50))
    const mixed = [...drew.values()].filter((ids) => new Set([...ids].map((id) => roleOf.get(id))).size > 1)
    expect(mixed.map((ids) => [...ids].map((id) => `${id}:${roleOf.get(id)}`))).toEqual([])
    // And rows still recycle within a kind.
    expect([...drew.values()].some((ids) => ids.size > 1)).toBe(true)
  })

  it('still keeps the row holding a selection to its own message', () => {
    const drew = recycle(transcript, window(0, 50), new Set(['m1']))
    expect([...drew.values()].filter((ids) => ids.has('m1')).map((ids) => [...ids])).toEqual([['m1']])
  })

  it('types one message, and nothing for an empty transcript', () => {
    expect(recycle([{ id: 'only', role: 'user' }], [[0, 0], [0, 0]]).size).toBe(1)
    expect(recycle([], [[-1, -2]]).size).toBe(0)
  })
})
