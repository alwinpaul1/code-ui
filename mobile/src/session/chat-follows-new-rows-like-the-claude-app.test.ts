import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FlashListRef } from '@shopify/flash-list'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
import { newRowsFollow, type ChatRowsSnapshot } from './chat-new-row-follow'
import {
  useMobileNativeChatTailFollow,
  type MobileNativeChatTailFollow
} from './use-mobile-native-chat-tail-follow'

vi.mock('react-native', () => ({ AppState: { addEventListener: () => ({ remove: () => {} }) } }))

// The user asked for the Claude app's scrolling (2026-10-17). Its rule for following new content
// (1.261013.20, kc0.java:51-66): new rows take the reader to the newest message when, before they
// landed, the reader sat on the newest row or the one above it, not more than half a viewport
// into it, and it was not older history paging in. A user drag holds the list's scroll mutex at
// UserInput priority, so the app's own scroll cannot run under a finger (lkm.java:20-21).

function before(over: Partial<ChatRowsSnapshot> = {}): ChatRowsSnapshot {
  return { count: 3, newestId: 'c', oldestId: 'a', firstVisibleIndex: 0, pastHalfIntoFirstRow: false, ...over }
}

describe("the Claude app's new-row rule", () => {
  it('follows a new message landing while the reader sits on the newest one or the one above', () => {
    expect(newRowsFollow(before(), { count: 4, newestId: 'd', oldestId: 'a' })).toBe(true)
    expect(newRowsFollow(before({ firstVisibleIndex: 1 }), { count: 4, newestId: 'd', oldestId: 'a' })).toBe(true)
  })

  it('leaves a reader two rows up, or deep in the newest row, where they are', () => {
    expect(newRowsFollow(before({ firstVisibleIndex: 2 }), { count: 4, newestId: 'd', oldestId: 'a' })).toBe(false)
    expect(newRowsFollow(before({ pastHalfIntoFirstRow: true }), { count: 4, newestId: 'd', oldestId: 'a' })).toBe(false)
  })

  it('never follows older history paging in, or a row that only grew', () => {
    expect(newRowsFollow(before(), { count: 5, newestId: 'c', oldestId: 'z' })).toBe(false)
    expect(newRowsFollow(before(), { count: 3, newestId: 'c', oldestId: 'a' })).toBe(false)
  })

  it('follows nothing out of an empty list, and follows the first reply after a single row', () => {
    expect(newRowsFollow(before({ count: 0, newestId: null, oldestId: null }), { count: 1, newestId: 'a', oldestId: 'a' })).toBe(false)
    expect(newRowsFollow(null, { count: 1, newestId: 'a', oldestId: 'a' })).toBe(false)
    expect(newRowsFollow(before({ count: 1, newestId: 'a', oldestId: 'a' }), { count: 2, newestId: 'b', oldestId: 'a' })).toBe(true)
  })
})

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

describe('the chat list follows new rows as the Claude app does', () => {
  let renderer: ReactTestRenderer | null = null
  let firstVisible = 0
  const list = {
    scrollToOffset: vi.fn(),
    getFirstVisibleIndex: () => firstVisible,
    getLayout: () => ({ x: 0, y: 0, width: 400, height: 900 })
  }
  const one = [{ id: 'a1' }]
  const two = [{ id: 'a2' }, { id: 'a1' }]

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 16) as unknown as number)
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
    vi.spyOn(console, 'info').mockImplementation(() => {})
    firstVisible = 0
    act(() => {
      renderer = create(createElement(Probe, { rows: one }))
    })
    latest!.listRef.current = list as unknown as FlashListRef<Row>
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    latest = null
    list.scrollToOffset.mockReset()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  /** A drag released at `y` that settles there: the reader has the list. */
  function readAt(y: number): void {
    act(() => latest!.touchStart())
    act(() => latest!.touchEnd())
    act(() => latest!.onScrollBeginDrag())
    act(() => latest!.evaluateEdge(at(y)))
    act(() => latest!.onScrollEndDrag(at(y)))
    act(() => {
      vi.advanceTimersByTime(300)
    })
  }

  function newRowLands(): void {
    act(() => renderer!.update(createElement(Probe, { rows: two })))
  }

  it('takes the reader to a new message when they sit just above the newest one', () => {
    readAt(120)
    expect(latest!.detachedFromTail).toBe(true)

    newRowLands()

    expect(list.scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: false })
    expect(latest!.detachedFromTail).toBe(false)
  })

  it('leaves a reader further up in history where they are when a new message lands', () => {
    readAt(1200)
    firstVisible = 3

    newRowLands()

    expect(list.scrollToOffset).not.toHaveBeenCalled()
    expect(latest!.detachedFromTail).toBe(true)
  })

  it('leaves a reader deep in the newest reply where they are', () => {
    readAt(300)

    newRowLands()

    expect(list.scrollToOffset).not.toHaveBeenCalled()
  })

  it('never moves the list under a finger when a new message lands', () => {
    readAt(120)
    act(() => latest!.touchStart())

    newRowLands()

    expect(list.scrollToOffset).not.toHaveBeenCalled()
  })

  it('never moves the list under a drag when a new message lands', () => {
    readAt(120)
    act(() => latest!.touchStart())
    act(() => latest!.touchEnd())
    act(() => latest!.onScrollBeginDrag())

    newRowLands()

    expect(list.scrollToOffset).not.toHaveBeenCalled()
    expect(latest!.detachedFromTail).toBe(true)
  })

  it('keeps the reader where they are when older history pages in', () => {
    readAt(120)

    act(() => renderer!.update(createElement(Probe, { rows: [{ id: 'a1' }, { id: 'a0' }] })))

    expect(list.scrollToOffset).not.toHaveBeenCalled()
  })
})
