import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FlashListRef } from '@shopify/flash-list'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
import { MISSING_DRAG_END_GRACE_MS } from './use-chat-missing-drag-end'
import {
  useMobileNativeChatTailFollow,
  type MobileNativeChatTailFollow
} from './use-mobile-native-chat-tail-follow'

vi.mock('react-native', () => ({ AppState: { addEventListener: () => ({ remove: () => {} }) } }))

// Second review of the 2026-10-17 scroll change (new-row follow, missing drag end). Each case
// below either confirms a regression (fails) or disproves one (passes).
//
// Geometry as FlashList 2.3.2 reports it for the chat's inverted list: data is newest first, so
// index 0 is the newest row and offset 0 is the live edge. `getLayout(i).y` is relative to the
// child container, which starts AFTER the ListHeaderComponent (RecyclerViewManager.ts:117
// subtracts `firstItemOffset` before it finds visible rows). In the chat that header is the queue,
// the working line and the dock spacer, so it is never zero on a device.

type Row = { id: string }
let latest: MobileNativeChatTailFollow<Row> | null = null

function Probe(props: { rows: readonly Row[] }) {
  latest = useMobileNativeChatTailFollow<Row>(props)
  return null
}

const VIEWPORT = 400

function at(y: number, height = 6000): NativeSyntheticEvent<NativeScrollEvent> {
  return {
    nativeEvent: { contentOffset: { y }, contentSize: { height }, layoutMeasurement: { height: VIEWPORT } }
  } as NativeSyntheticEvent<NativeScrollEvent>
}

/** A FlashList as the chat's inverted list measures it: rows of the given heights, newest first,
 *  under a header `header` px tall. */
function fakeList(heights: number[], header: number) {
  let offset = 0
  const ys = heights.map((_, i) => heights.slice(0, i).reduce((a, b) => a + b, 0))
  return {
    scrollToOffset: vi.fn(),
    setOffset(y: number) {
      offset = y
    },
    getFirstItemOffset: () => header,
    getLayout: (i: number) => ({ x: 0, y: ys[i] ?? 0, width: 400, height: heights[i] ?? 0 }),
    // RecyclerViewManager.computeVisibleIndices: the viewport starts at offset - firstItemOffset.
    getFirstVisibleIndex: () => {
      const start = offset - header
      return ys.findIndex((y, k) => y + (heights[k] ?? 0) > start)
    }
  }
}

describe('second review: new rows following the reader', () => {
  let renderer: ReactTestRenderer | null = null
  let list = fakeList([900, 900, 900], 0)

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 16) as unknown as number)
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
    vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    latest = null
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  function mount(rows: readonly Row[], l: ReturnType<typeof fakeList>): void {
    list = l
    act(() => {
      renderer = create(createElement(Probe, { rows }))
    })
    latest!.listRef.current = list as unknown as FlashListRef<Row>
  }

  function readAt(y: number): void {
    list.setOffset(y)
    act(() => latest!.touchStart())
    act(() => latest!.touchEnd())
    act(() => latest!.onScrollBeginDrag())
    act(() => latest!.evaluateEdge(at(y)))
    act(() => latest!.onScrollEndDrag(at(y)))
    act(() => {
      vi.advanceTimersByTime(300)
    })
    list.scrollToOffset.mockClear()
  }

  function show(rows: readonly Row[]): void {
    act(() => renderer!.update(createElement(Probe, { rows })))
  }

  const three = [{ id: 'c' }, { id: 'b' }, { id: 'a' }]

  it('never moves the reader while the newest reply only streams more text', () => {
    mount(three, fakeList([900, 900, 900], 0))
    readAt(100)
    // Same rows, a new array per token, as the streaming bubble produces.
    show([{ id: 'c' }, { id: 'b' }, { id: 'a' }])
    show([{ id: 'c' }, { id: 'b' }, { id: 'a' }])
    expect(list.scrollToOffset).not.toHaveBeenCalled()
    expect(latest!.detachedFromTail).toBe(true)
  })

  it('never moves a reader just above the newest row when older history pages in', () => {
    mount(three, fakeList([900, 900, 900], 0))
    readAt(100)
    show([...three, { id: 'z' }, { id: 'y' }])
    expect(list.scrollToOffset).not.toHaveBeenCalled()
  })

  it('does not follow on mount, or out of an empty list', () => {
    mount([], fakeList([], 0))
    show(three)
    expect(list.scrollToOffset).not.toHaveBeenCalled()
  })

  it('leaves a reader who scrolled more than half a screen into the newest reply', () => {
    mount(three, fakeList([900, 900, 900], 0))
    readAt(250) // 250 > 400 / 2
    show([{ id: 'd' }, ...three])
    expect(list.scrollToOffset).not.toHaveBeenCalled()
  })

  // CONFIRMED (fail-safe direction): `rowsGeometry` measures "how far into the first row" as
  // contentOffset.y - getLayout(i).y, but getLayout is relative to the child container, which starts
  // after the header (queue, working line, dock spacer). The reader below sits 50 px short of the
  // newest row's start: still looking at the working line, the newest reply wholly on screen. The
  // Claude app's rule follows; the port reads 250 px "into" the row and does not. With the keyboard
  // up (viewport halved) and a dock spacer taller than half of it, the rule can never fire at all.
  it('follows a new row for a reader still looking at the working line under the newest reply', () => {
    mount(three, fakeList([900, 900, 900], 300))
    readAt(250)
    show([{ id: 'd' }, ...three])
    expect(list.scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: false })
  })

  // Parity, not a regression: index 1 past a TALL newest row. The reader is 3100 px up, reading the
  // row above a long reply; a new row brings them all the way down. kc0 does the same (index <= 1).
  it('brings a reader one row above a long reply back down when a row lands (Claude app parity)', () => {
    mount(three, fakeList([3000, 900, 900], 0))
    readAt(3100)
    show([{ id: 'd' }, ...three])
    expect(list.scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: false })
  })

  it('does not move the list under a fling still in flight when a row lands', () => {
    mount(three, fakeList([900, 900, 900], 0))
    readAt(100)
    act(() => latest!.onScrollBeginDrag())
    act(() => latest!.onScrollEndDrag(at(120)))
    act(() => latest!.onMomentumScrollBegin())
    act(() => latest!.evaluateEdge(at(140)))
    show([{ id: 'd' }, ...three])
    expect(list.scrollToOffset).not.toHaveBeenCalled()
  })

  it('does not move a reader holding a selection open when a row lands', () => {
    mount(three, fakeList([900, 900, 900], 0))
    readAt(100)
    const owner = {}
    act(() => latest!.reportSelection(owner, true))
    show([{ id: 'd' }, ...three])
    expect(list.scrollToOffset).not.toHaveBeenCalled()
  })

  // A tab switch with no remount: another session's rows, more of them, every id new.
  it('switching to a longer session with no remount takes the reader to its newest message', () => {
    mount(three, fakeList([900, 900, 900], 0))
    readAt(100)
    show([{ id: 'x5' }, { id: 'x4' }, { id: 'x3' }, { id: 'x2' }, { id: 'x1' }])
    expect(list.scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: false })
  })

  // The dock re-pin must still go straight to the list while following (2026-09-14 incident).
  it('still re-pins to the newest message on a dock resize with no new data', () => {
    mount(three, fakeList([900, 900, 900], 0))
    act(() => latest!.pinToTail())
    expect(list.scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: false })
  })
})

describe('second review: the missing drag end', () => {
  let renderer: ReactTestRenderer | null = null
  const list = { ...fakeList([900, 900, 900], 0) }
  let lines: string[] = []

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 16) as unknown as number)
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
    lines = []
    vi.spyOn(console, 'info').mockImplementation((line: unknown) => {
      lines.push(String(line))
    })
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
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  function wait(ms: number): void {
    act(() => {
      vi.advanceTimersByTime(ms)
    })
  }

  function dragFromTheTail(y: number): void {
    act(() => latest!.touchStart())
    act(() => latest!.touchEnd())
    act(() => latest!.onScrollBeginDrag())
    act(() => latest!.evaluateEdge(at(y)))
  }

  const missing = () => lines.filter((l) => l.includes('drag end missing'))

  it('settles a plain lift once when its end-drag lands just inside the grace', () => {
    dragFromTheTail(12)
    act(() => latest!.scrollGestureEnded(false))
    wait(MISSING_DRAG_END_GRACE_MS - 20)
    act(() => latest!.onScrollEndDrag(at(14)))
    wait(200)
    expect(missing()).toEqual([])
    expect(lines.filter((l) => l.includes('drag end at') || l.includes('drag end ')).length).toBe(1)
    expect(latest!.detachedFromTail).toBe(false)
  })

  // The end-drag arriving AFTER the grace (a JS thread busy for > 120 ms): the hook already ended
  // the drag and settled at the tail; the late end-drag and the fling must still win.
  it('leaves a flick at the tail with the reader when its end-drag lands after the grace', () => {
    dragFromTheTail(12)
    act(() => latest!.scrollGestureEnded(false))
    wait(MISSING_DRAG_END_GRACE_MS + 5)
    act(() => latest!.onScrollEndDrag(at(14)))
    act(() => latest!.onMomentumScrollBegin())
    act(() => latest!.evaluateEdge(at(200)))
    act(() => renderer!.update(createElement(Probe, { rows: [{ id: 'a2' }, { id: 'a1' }] })))
    act(() => latest!.pinToTailAfterContentResize(400, 2600))
    expect(list.scrollToOffset).not.toHaveBeenCalled()
    expect(latest!.detachedFromTail).toBe(true)
  })

  it('a cancel then a quick new touch ends the old drag once and lets the new one drag', () => {
    dragFromTheTail(300)
    act(() => latest!.scrollGestureEnded(true))
    wait(40)
    act(() => latest!.touchStart())
    act(() => latest!.touchEnd())
    act(() => latest!.onScrollBeginDrag())
    wait(MISSING_DRAG_END_GRACE_MS + 50)
    // The old timer is gone: the new drag is still open, not ended by the old gesture.
    expect(missing()).toEqual(['[chat-scroll] drag end missing, ended by the next touch down'])
    act(() => latest!.evaluateEdge(at(10)))
    act(() => renderer!.update(createElement(Probe, { rows: [{ id: 'a2' }, { id: 'a1' }] })))
    act(() => latest!.pinToTailAfterContentResize(400, 2600))
    expect(list.scrollToOffset).not.toHaveBeenCalled()
  })
})
