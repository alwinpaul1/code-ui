import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMobileChatFollowing } from './use-mobile-chat-following'

type Api = ReturnType<typeof useMobileChatFollowing>
let latest: Api | null = null
function Probe() {
  latest = useMobileChatFollowing()
  return null
}

describe('chat text selection around a scroll', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    latest = null
  })

  // 2026-09-12: random buzzes while scrolling. Android arms a text-selection
  // long-press under any selectable Text; a finger put down to stop a fling
  // and held tripped it. The rows read this flag through a context.
  it('is off while a scroll is in flight and back on when it settles', () => {
    act(() => {
      renderer = create(createElement(Probe))
    })
    expect(latest!.textSelectable).toBe(true)
    act(() => latest!.beginScroll())
    expect(latest!.textSelectable).toBe(false)
    act(() => latest!.endScroll())
    expect(latest!.textSelectable).toBe(true)
  })

  // 2026-09-21, phone recording: a hold on the agent's prose, on a list that
  // had been still for half a second, selected nothing. The flag is turned
  // off by a drag or a fling and back on only by the END events, and a fling
  // that a re-anchor or a nested scroll view interrupts never sends one. The
  // finger lifting and the samples stopping are evidence enough that the
  // list is at rest; a missed end event must not cost the reader selection
  // until their next clean scroll.
  it('comes back on its own once the finger is up and the list has stopped moving, even with no end event', () => {
    vi.useFakeTimers()
    act(() => {
      renderer = create(createElement(Probe))
    })
    act(() => {
      latest!.touchStart()
      latest!.beginScroll()
    })
    act(() => {
      latest!.touchEnd()
    })
    // A fling: samples keep the window closed while the list still moves.
    act(() => {
      vi.advanceTimersByTime(200)
      latest!.scrollSample()
      vi.advanceTimersByTime(200)
      latest!.scrollSample()
    })
    expect(latest!.textSelectable).toBe(false)
    // …and no momentum-end ever arrives.
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(latest!.textSelectable).toBe(true)
    vi.useRealTimers()
  })

  it('stays off while the finger that stopped a fling is still down, the 2026-09-12 rule', () => {
    vi.useFakeTimers()
    act(() => {
      renderer = create(createElement(Probe))
    })
    act(() => {
      latest!.touchStart()
      latest!.beginScroll()
    })
    act(() => {
      vi.advanceTimersByTime(2_000)
    })
    expect(latest!.textSelectable).toBe(false)
    act(() => {
      latest!.touchEnd()
      vi.advanceTimersByTime(300)
    })
    expect(latest!.textSelectable).toBe(true)
    vi.useRealTimers()
  })

  it('stops following on a drag, so nothing yanks the reader while they scroll', () => {
    act(() => {
      renderer = create(createElement(Probe))
    })
    act(() => latest!.beginScroll())
    expect(latest!.followingRef.current).toBe(false)
    expect(latest!.showJumpToLatest).toBe(true)
  })
})

describe('a finger on the list', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    latest = null
    vi.useRealTimers()
  })

  // 2026-09-12 22:49 recording: the copy toolbar was up and the streaming
  // reply kept pulling the list down under the selection.
  it('takes control after a long-press, so streaming cannot move the selection', () => {
    vi.useFakeTimers()
    act(() => {
      renderer = create(createElement(Probe))
    })
    act(() => latest!.touchStart())
    expect(latest!.holdingRef.current).toBe(true)
    vi.advanceTimersByTime(450)
    act(() => latest!.touchEnd())
    expect(latest!.holdingRef.current).toBe(false)
    expect(latest!.followingRef.current).toBe(false)
    expect(latest!.showJumpToLatest).toBe(true)
  })

  // 2026-09-15, reported from the phone: "when i click and hold to copy a
  // sentence or paragraph it moves down or drifts away".
  //
  // Releasing is too late to matter. The list's native scroll anchoring is
  // configured `{ disabled: !showJumpToLatest }`, so while the reader still
  // counts as following, nothing holds the content still — and the whole
  // press-and-hold ran as "following", because intent only flipped at
  // `touchEnd`. By then the selection has already slid off under the stream.
  // Control has to pass at the long-press mark, with the finger still down.
  it('takes control while the finger is still down, not when it lifts', () => {
    vi.useFakeTimers()
    act(() => {
      renderer = create(createElement(Probe))
    })
    act(() => latest!.touchStart())
    expect(latest!.followingRef.current).toBe(true)
    act(() => {
      vi.advanceTimersByTime(450)
    })
    // Still holding — no touchEnd yet — and the list must already be the
    // reader's, so the anchoring the jump flag drives is on for the selection.
    expect(latest!.holdingRef.current).toBe(true)
    expect(latest!.followingRef.current).toBe(false)
    expect(latest!.showJumpToLatest).toBe(true)
  })

  it('does not take control from a finger that lifts before the long-press', () => {
    vi.useFakeTimers()
    act(() => {
      renderer = create(createElement(Probe))
    })
    act(() => latest!.touchStart())
    act(() => {
      vi.advanceTimersByTime(80)
    })
    act(() => latest!.touchEnd())
    act(() => {
      // The armed timer must not fire after the finger is gone.
      vi.advanceTimersByTime(600)
    })
    expect(latest!.followingRef.current).toBe(true)
    expect(latest!.showJumpToLatest).toBe(false)
  })

  it('leaves following alone after a tap', () => {
    vi.useFakeTimers()
    act(() => {
      renderer = create(createElement(Probe))
    })
    act(() => latest!.touchStart())
    vi.advanceTimersByTime(80)
    act(() => latest!.touchEnd())
    expect(latest!.followingRef.current).toBe(true)
  })
})
