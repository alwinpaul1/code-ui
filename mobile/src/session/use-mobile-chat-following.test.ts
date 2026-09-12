import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it } from 'vitest'
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

  it('stops following on a drag, so nothing yanks the reader while they scroll', () => {
    act(() => {
      renderer = create(createElement(Probe))
    })
    act(() => latest!.beginScroll())
    expect(latest!.followingRef.current).toBe(false)
    expect(latest!.showJumpToLatest).toBe(true)
  })
})
