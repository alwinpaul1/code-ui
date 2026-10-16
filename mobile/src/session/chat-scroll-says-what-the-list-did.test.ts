import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FlashListRef } from '@shopify/flash-list'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
import {
  useMobileNativeChatTailFollow,
  type MobileNativeChatTailFollow
} from './use-mobile-native-chat-tail-follow'

vi.mock('react-native', () => ({ AppState: { addEventListener: () => ({ remove: () => {} }) } }))

// "Scroll sometimes getting stuck" while Claude worked (2026-10-17): the phone's log held the
// native touches and nothing of what the list decided. These pin the lines that say it.

type Row = { id: string }
let latest: MobileNativeChatTailFollow<Row> | null = null

function Probe(props: { rows: readonly Row[] }) {
  latest = useMobileNativeChatTailFollow<Row>(props)
  return null
}

function at(y: number): NativeSyntheticEvent<NativeScrollEvent> {
  return {
    nativeEvent: { contentOffset: { y }, contentSize: { height: 2400 }, layoutMeasurement: { height: 400 } }
  } as NativeSyntheticEvent<NativeScrollEvent>
}

type InfoSpy = { mock: { calls: unknown[][] }; mockRestore: () => void }

function scrollLines(info: InfoSpy): string[] {
  return info.mock.calls.map((call: unknown[]) => String(call[0])).filter((line: string) => line.startsWith('[chat-scroll]'))
}

describe('the chat log says what the transcript did with a finger', () => {
  let renderer: ReactTestRenderer | null = null
  let info: InfoSpy
  const list = { scrollToOffset: vi.fn(), scrollToEnd: vi.fn(), scrollToIndex: vi.fn() }

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => {})
    info = vi.spyOn(console, 'info').mockImplementation(() => {})
    act(() => {
      renderer = create(createElement(Probe, { rows: [{ id: 'a1' }] }))
    })
    latest!.listRef.current = list as unknown as FlashListRef<Row>
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    latest = null
    list.scrollToOffset.mockReset()
    info.mockRestore()
    vi.unstubAllGlobals()
  })

  it('names a touch the list never took as a drag', () => {
    act(() => latest!.touchStart())
    act(() => latest!.touchEnd())

    expect(scrollLines(info)).toEqual(['[chat-scroll] touch down, following', '[chat-scroll] touch up with no drag'])
  })

  it('names a drag from start to end, and the list leaving the newest message', () => {
    act(() => latest!.touchStart())
    act(() => latest!.onScrollBeginDrag())
    act(() => latest!.onScrollEndDrag(at(612.4)))
    act(() => latest!.touchEnd())

    expect(scrollLines(info)).toEqual([
      '[chat-scroll] touch down, following',
      '[chat-scroll] drag start, was following',
      '[chat-scroll] the reader has the list',
      '[chat-scroll] drag end y=612',
      '[chat-scroll] touch up'
    ])
  })

  it('names a pin that pulls the list to the newest message from away, and not one at the tail', () => {
    act(() => latest!.pinToTail())
    expect(scrollLines(info)).toEqual([])

    act(() => latest!.evaluateEdge(at(300)))
    act(() => latest!.pinToTail())

    expect(scrollLines(info)).toEqual(['[chat-scroll] pinned to the newest message from away'])
    expect(list.scrollToOffset).toHaveBeenCalledTimes(2)
  })
})
