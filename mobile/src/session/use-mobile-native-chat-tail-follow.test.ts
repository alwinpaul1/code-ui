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
