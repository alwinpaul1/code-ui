import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FlashListRef } from '@shopify/flash-list'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
import {
  useMobileNativeChatTailFollow,
  type MobileNativeChatTailFollow
} from './use-mobile-native-chat-tail-follow'

type Row = { id: string }
type Api = MobileNativeChatTailFollow<Row>

let latest: Api | null = null

function Probe(props: {
  rows: readonly Row[]
  hasMore?: boolean
  loadingEarlier?: boolean
  onLoadEarlier?: () => void
}) {
  latest = useMobileNativeChatTailFollow<Row>(props)
  return null
}

/** What the list would do if the hook asked it to move. */
function stubList(): {
  scrollToOffset: ReturnType<typeof vi.fn>
  scrollToEnd: ReturnType<typeof vi.fn>
  scrollToIndex: ReturnType<typeof vi.fn>
} {
  return { scrollToOffset: vi.fn(), scrollToEnd: vi.fn(), scrollToIndex: vi.fn() }
}

/** A scroll sample. The list is inverted, so `y` counts UP from the newest
 *  message: 0 is the live edge and a large offset is old history. */
function at(y: number, contentHeight = 2400): NativeSyntheticEvent<NativeScrollEvent> {
  return {
    nativeEvent: {
      contentOffset: { y },
      contentSize: { height: contentHeight },
      layoutMeasurement: { height: 400 }
    }
  } as NativeSyntheticEvent<NativeScrollEvent>
}

describe('the chat transcript has one owner for its scroll position', () => {
  let renderer: ReactTestRenderer | null = null
  const list = stubList()

  function render(props: Parameters<typeof Probe>[0] = { rows: [{ id: 'a1' }] }): void {
    act(() => {
      renderer = create(createElement(Probe, props))
    })
    latest!.listRef.current = list as unknown as FlashListRef<Row>
  }

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    latest = null
    list.scrollToOffset.mockReset()
    list.scrollToEnd.mockReset()
    list.scrollToIndex.mockReset()
  })

  // The upstream hook this is ported from (Orca 2fc84cb49, #20493) owns a
  // NON-inverted list, so it pins at the height the list just measured —
  // `scrollToEnd`, or `scrollToOffset({ offset: measuredHeight })`. Here the
  // tail is the constant offset 0, and a pin at a measured height would land
  // the reader at the far end of history instead of on the newest message.
  it('pins the newest row at offset zero, never at the height the list just measured', () => {
    render()

    act(() => latest!.pinToTailAfterContentResize(400, 2400))

    expect(list.scrollToOffset.mock.calls).toEqual([[{ offset: 0, animated: false }]])
    expect(list.scrollToEnd).not.toHaveBeenCalled()
  })

  // 2026-09-12: press and hold a sentence and the transcript jumped to the
  // newest message before the copy toolbar could appear. Selection handles
  // re-measure the text, which is a content-size change with no new data.
  it('will not move the list while a finger is down on the transcript', () => {
    render()

    act(() => latest!.touchStart())
    act(() => latest!.pinToTailAfterContentResize(400, 2600))

    expect(list.scrollToOffset).not.toHaveBeenCalled()
  })

  // 2026-09-14 review: the guard above lived only on the content-resize path,
  // so the dock's re-pin and the list's own onLayout could still move the list
  // under a held finger — the same select-text-and-jump symptom, reached by the
  // two callers added when this hook took ownership.
  it('will not move the list from a dock or layout re-pin while a finger is down', () => {
    render()

    act(() => latest!.touchStart())
    act(() => latest!.pinToTail())

    expect(list.scrollToOffset).not.toHaveBeenCalled()
  })

  // 2026-09-15 regression review: the long-press hand-over was undone by the
  // very first scroll sample. A long-press is not a drag, so `scrollingRef` is
  // false, and any sample inside the tail slop put `following` back on — which
  // switched the list's native scroll anchoring back off and let the stream
  // slide the selection away again. Enabling that anchoring is itself what
  // moves `contentOffset` off 0, so the fix generated the sample that undid it.
  // A finger on the glass owns the list, exactly as the re-pin paths already
  // assume.
  it('does not hand the list back on a scroll sample while a finger is still down', () => {
    vi.useFakeTimers()
    try {
      render()
      act(() => latest!.touchStart())
      // The long-press mark passes with the finger still down: the reader owns
      // the list, which is what turns the native scroll anchoring on.
      act(() => {
        vi.advanceTimersByTime(450)
      })
      expect(latest!.showJumpToLatest).toBe(true)

      // A sample right at the live edge — exactly what enabling that anchoring
      // produces — must NOT hand the list back.
      act(() => latest!.evaluateEdge(at(0)))
      expect(latest!.showJumpToLatest).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('hands the list back on a settled sample at the tail once the finger lifts', () => {
    vi.useFakeTimers()
    try {
      render()
      act(() => latest!.touchStart())
      act(() => {
        vi.advanceTimersByTime(450)
      })
      act(() => latest!.touchEnd())

      act(() => latest!.evaluateEdge(at(0)))
      expect(latest!.showJumpToLatest).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  // 2026-09-15 regression review: the holding guard above stops `following`
  // being handed back mid-long-press — correct — but the history-paging branch
  // beside it never checked `holding` at all. In a conversation short enough
  // that the live edge and the start of loaded history OVERLAP, holding a
  // selection left following false and immediately paged in older history,
  // detaching the list from the tail under the reader's finger. A finger down
  // is a finger down for both branches.
  it('does not page in history under a finger held on a short conversation', () => {
    vi.useFakeTimers()
    try {
      const onLoadEarlier = vi.fn()
      render({ rows: [{ id: 'a1' }], hasMore: true, onLoadEarlier })
      act(() => latest!.touchStart())
      act(() => {
        vi.advanceTimersByTime(450)
      })
      // Content barely taller than the viewport: at the tail AND at the start
      // of loaded history at the same time.
      act(() => latest!.evaluateEdge(at(0, 440)))
      expect(onLoadEarlier).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('still pages in history once the finger lifts', () => {
    vi.useFakeTimers()
    try {
      const onLoadEarlier = vi.fn()
      render({ rows: [{ id: 'a1' }], hasMore: true, onLoadEarlier })
      act(() => latest!.onScrollBeginDrag())
      act(() => latest!.evaluateEdge(at(0, 440)))
      expect(onLoadEarlier).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  // The dock's height is the spacer at the list's end; when it grows, the
  // newest row ends up underneath it. That re-pin is the same command as every
  // other, so it goes through the same owner and obeys the same refusal.
  it('lets a dock or viewport resize re-pin only while the reader is still following', () => {
    render()

    act(() => latest!.pinToTail())
    expect(list.scrollToOffset.mock.calls).toEqual([[{ offset: 0, animated: false }]])

    list.scrollToOffset.mockReset()
    act(() => latest!.onScrollBeginDrag())
    act(() => latest!.pinToTail())
    expect(list.scrollToOffset).not.toHaveBeenCalled()
  })

  // 2026-09-14 review (Opus + Sonnet): the hold guard was added by routing
  // pinToTail through the follow gate, which ALSO consumes the gate's one-shot
  // "new data" flag. That flag is for the content-resize path — a re-measure
  // must not follow. But the dock re-pin and onLayout legitimately fire with no
  // new data: the keyboard opens under an idle agent, the composer grows, a
  // permission card appears. Gating those on new data hid the newest row under
  // the dock again — the exact 2026-09-13 bug the dock re-pin exists to fix.
  it('re-pins on every dock or layout resize while following, even with no new message', () => {
    render()

    // First re-pin (keyboard opens): scrolls to the tail.
    act(() => latest!.pinToTail())
    // Second re-pin (composer grows a line) with no new data in between: must
    // still scroll, or the newest row sits under the dock.
    act(() => latest!.pinToTail())

    expect(list.scrollToOffset.mock.calls).toEqual([
      [{ offset: 0, animated: false }],
      [{ offset: 0, animated: false }]
    ])
  })

  it('never pins an empty transcript, which has no newest row to pin to', () => {
    render({ rows: [] })

    act(() => latest!.pinToTail())
    act(() => latest!.pinToTailAfterContentResize(400, 0))

    expect(list.scrollToOffset).not.toHaveBeenCalled()
  })

  // Paging in older history grows the content by a screenful or more. The
  // reader asked for it, so nothing about that growth may pull them to the
  // newest message.
  it('keeps the reader where they are when older history pages in', () => {
    const onLoadEarlier = vi.fn()
    render({ rows: [{ id: 'a1' }], hasMore: true, onLoadEarlier })

    act(() => latest!.onScrollBeginDrag())
    act(() => latest!.evaluateEdge(at(1980)))
    expect(onLoadEarlier).toHaveBeenCalledOnce()

    // The older rows land: new data, and a much taller list.
    act(() => renderer!.update(createElement(Probe, { rows: [{ id: 'a0' }, { id: 'a1' }] })))
    act(() => latest!.pinToTailAfterContentResize(400, 9600))

    expect(list.scrollToOffset).not.toHaveBeenCalled()
    expect(latest!.showJumpToLatest).toBe(true)
  })

  it('hands the list to the reader when they jump to one message, and back when they ask for the newest', () => {
    render()

    act(() => latest!.onScrollToMessage(3))
    expect(list.scrollToIndex.mock.calls).toEqual([
      [{ index: 3, viewPosition: 1, animated: true }]
    ])
    expect(latest!.showJumpToLatest).toBe(true)

    act(() => latest!.jumpToTail(true))
    expect(list.scrollToOffset.mock.calls).toEqual([[{ offset: 0, animated: true }]])
    expect(latest!.showJumpToLatest).toBe(false)
  })
})

// Three owners is how streaming came to jump in the first place: the view
// pinned on content growth, the dock hook pinned on its own height, and the
// scroll handlers jumped. They cannot disagree if only one of them can speak.
it('leaves the chat list with exactly one caller that can move it', () => {
  const callers = ['MobileNativeChatView.tsx', 'use-mobile-chat-dock.ts', 'use-mobile-chat-following.ts']
  for (const file of callers) {
    const source = readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), 'utf8')
    expect({ file, moves: source.includes('.scrollTo') }).toEqual({ file, moves: false })
  }
})
