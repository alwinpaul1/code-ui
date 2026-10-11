import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FlashListRef } from '@shopify/flash-list'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
import {
  useMobileNativeChatTailFollow,
  type MobileNativeChatTailFollow
} from './use-mobile-native-chat-tail-follow'

// Reported 2026-10-11 with the same session recorded in the Claude app and in
// Code UI: at the very end of the conversation (the last row and the composer
// in view, nothing further to scroll to) a drag toward the newest message
// raised the centred ↓ in Code UI. The Claude app shows none there. The user:
// "when I scroll and try to scroll down and if there is nothing, the arrow
// appears".
//
// Why: the button was drawn from INTENT alone. A drag's begin, or a finger
// held 400 ms, stops the list following, and the button rose with it before
// the list had moved a pixel. Intent still owns the native scroll anchoring;
// the button needs content below the viewport as well.

vi.mock('./use-app-interruptions', () => ({ useAppInterruptions: () => undefined }))

type Row = { id: string }
let latest: MobileNativeChatTailFollow<Row> | null = null

function Probe(props: { rows: readonly Row[] }) {
  latest = useMobileNativeChatTailFollow<Row>(props)
  return null
}

/** A scroll sample of the INVERTED list: `y` counts up from the newest row, so
 *  0 is the very end of the conversation and a negative `y` is an over-scroll
 *  past it. */
function at(y: number, contentHeight: number, viewport = 700): NativeSyntheticEvent<NativeScrollEvent> {
  return {
    nativeEvent: {
      contentOffset: { x: 0, y },
      contentSize: { width: 400, height: contentHeight },
      layoutMeasurement: { width: 400, height: viewport }
    }
  } as NativeSyntheticEvent<NativeScrollEvent>
}

const rowsOf = (count: number): Row[] => Array.from({ length: count }, (_, index) => ({ id: `m${index}` }))

describe('the jump-to-latest arrow', () => {
  let renderer: ReactTestRenderer | null = null

  function mount(rows: readonly Row[]): void {
    act(() => {
      renderer = create(createElement(Probe, { rows }))
    })
    latest!.listRef.current = { scrollToOffset: vi.fn(), scrollToEnd: vi.fn(), scrollToIndex: vi.fn() } as unknown as FlashListRef<Row>
  }

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    latest = null
    vi.useRealTimers()
  })

  it('does not show when the reader drags toward the newest message at the very end', () => {
    mount(rowsOf(40))
    act(() => latest!.onScrollBeginDrag())
    act(() => latest!.evaluateEdge(at(0, 6000)))
    expect(latest!.showJumpToLatest).toBe(false)
  })

  it('does not show on an over-scroll past the end', () => {
    mount(rowsOf(40))
    act(() => latest!.onScrollBeginDrag())
    act(() => latest!.evaluateEdge(at(-18, 6000)))
    expect(latest!.showJumpToLatest).toBe(false)
  })

  it('does not show when a drag begins before any sample has come (an empty list)', () => {
    mount([])
    act(() => latest!.onScrollBeginDrag())
    expect(latest!.showJumpToLatest).toBe(false)
  })

  for (const [label, rows, height] of [
    ['one row', rowsOf(1), 120],
    ['content shorter than the screen', rowsOf(3), 480]
  ] as const) {
    it(`does not show for ${label}, which has nothing below to scroll to`, () => {
      mount(rows)
      act(() => latest!.onScrollBeginDrag())
      act(() => latest!.evaluateEdge(at(0, height)))
      expect(latest!.showJumpToLatest).toBe(false)
    })
  }

  it('does not show for a finger held on the newest message, though the list stops following', () => {
    vi.useFakeTimers()
    mount(rowsOf(40))
    act(() => latest!.touchStart())
    act(() => {
      vi.advanceTimersByTime(450)
    })
    // Intent still hands the list to the reader: the native anchoring must hold
    // the text being selected still.
    expect(latest!.detachedFromTail).toBe(true)
    expect(latest!.showJumpToLatest).toBe(false)
  })

  it('shows once the reader has scrolled up into history, and goes when they come back to the end', () => {
    mount(rowsOf(40))
    act(() => latest!.onScrollBeginDrag())
    act(() => latest!.evaluateEdge(at(600, 6000)))
    expect(latest!.showJumpToLatest).toBe(true)

    act(() => latest!.evaluateEdge(at(0, 6000)))
    expect(latest!.showJumpToLatest).toBe(false)
  })
})
