import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FlashListRef } from '@shopify/flash-list'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
import {
  useMobileNativeChatTailFollow,
  type MobileNativeChatTailFollow
} from './use-mobile-native-chat-tail-follow'

// Hold to copy, while the agent is working (2026-09-25, phone recording):
// the reader held a paragraph and a bullet of the agent's reply for seconds
// and got nothing. No handles, no Copy bar. The Claude app selects the word.
//
// These tests drive the real tail-follow owner (and through it the
// following hook) with the event sequence a streaming turn produces on
// Android. Each native step below is read from the sources this build ships
// (React Native 0.86.3, @shopify/flash-list 2.3.2), not observed on the
// device:
//
// - The chat stream is throttled to 50 ms (`NATIVE_CHAT_STREAM_THROTTLE_MS`
//   in use-mobile-native-chat-controller.ts), so the streaming reply grows
//   up to twenty times a second.
// - While the reader is off the live edge, FlashList holds their place
//   (`maintainVisibleContentPosition`, on whenever the jump control shows):
//   its ScrollAnchor moves by exactly what the rows above grew, and the
//   native helper scrolls by the same amount. The list sends an `onScroll`
//   for each correction, with the offset AND the content height moved by
//   that growth.
// - ReactScrollView sets `mActivelyScrolling` on every `onScrollChanged`,
//   corrections included, and sends `onMomentumScrollEnd` only after three
//   post-touch checks (20 ms apart) with no scroll change. A correction
//   every 50 ms never leaves that gap, so the end never comes while the
//   reply streams.
// - Android sends no `onScroll` when a re-pin finds the list already at
//   offset 0.
//
// So after any drag, the old hook saw a scroll that never ended: every
// correction restarted its 250 ms quiet window, and the text stayed
// unselectable until the reply stopped. With the stream stopped the same
// fling sequence restored selection on the old hook too.
//
// What only the device can confirm: how fast the host's stream really grew
// the reply during the recording, and that Android then starts its own
// selection under the held finger (word, handles, Copy / Select all).

type Row = { id: string; text: string }
type Api = MobileNativeChatTailFollow<Row>

let latest: Api | null = null

function Probe(props: { rows: readonly Row[] }) {
  latest = useMobileNativeChatTailFollow<Row>(props)
  return null
}

/** One wrapped line of the streaming reply, in dp. */
const LINE_DP = 24
/** The controller's stream throttle: the reply grows at most this often. */
const STREAM_TICK_MS = 50
/** `scrollEventThrottle={16}` on the chat list. */
const FRAME_MS = 16

function sample(y: number, height: number): NativeSyntheticEvent<NativeScrollEvent> {
  return {
    nativeEvent: {
      contentOffset: { x: 0, y },
      contentSize: { width: 400, height },
      layoutMeasurement: { width: 400, height: 700 }
    }
  } as NativeSyntheticEvent<NativeScrollEvent>
}

/** Where the native list is. The inverted list's live edge is offset 0.
 *  `coalesce`: every other place-holding correction sends no event of its
 *  own and rides on the next fling frame's, as a throttled scroll does. */
const world = { y: 0, height: 5000, streamed: 0, coalesce: false }

/** What the native list does when the hook asks it to move: it moves, and
 *  reports a scroll only if it actually went somewhere. */
const list = {
  scrollToOffset: vi.fn(({ offset }: { offset: number }) => {
    if (world.y !== offset) {
      world.y = offset
      latest!.evaluateEdge(sample(world.y, world.height))
    }
  }),
  scrollToIndex: vi.fn(),
  scrollToEnd: vi.fn()
}

let renderer: ReactTestRenderer | null = null
let now = 0

function rows(): Row[] {
  return [
    { id: 'u1', text: 'Is agent session search on the phone?' },
    // The reply on screen is still streaming: one more line per tick.
    { id: 'a1', text: 'One thing is out of the phone’s reach.'.repeat(world.streamed + 1) }
  ]
}

function mount(): void {
  world.y = 0
  world.height = 5000
  world.streamed = 0
  world.coalesce = false
  now = 0
  act(() => {
    renderer = create(createElement(Probe, { rows: rows() }))
  })
  latest!.listRef.current = list as unknown as FlashListRef<Row>
}

/** One stream tick: the reply grows a line, the list re-measures, and the
 *  native side answers — a re-pin while following, a place-holding
 *  correction while the reader is off the edge. */
function streamTick(): void {
  world.streamed += 1
  act(() => renderer!.update(createElement(Probe, { rows: rows() })))
  act(() => {
    world.height += LINE_DP
    // FlashList's onContentSizeChange: the only NEW-data follow path.
    latest!.pinToTailAfterContentResize(400, world.height)
    if (latest!.showJumpToLatest) {
      // maintainVisibleContentPosition is on: hold the reader's place.
      world.y += LINE_DP
      if (!(world.coalesce && world.streamed % 2 === 0)) {
        latest!.evaluateEdge(sample(world.y, world.height))
      }
    }
  })
}

type Frame = { at: number; run: () => void }

/** Runs the stream alongside `frames` for `ms`, in time order. */
function runFor(ms: number, frames: Frame[] = [], stream = true): void {
  const until = now + ms
  const queue = [...frames].sort((left, right) => left.at - right.at)
  let nextTick = stream ? Math.ceil((now + 1) / STREAM_TICK_MS) * STREAM_TICK_MS : Infinity
  for (;;) {
    const nextFrame = queue[0]?.at ?? Infinity
    const next = Math.min(nextTick, nextFrame)
    if (next > until) {
      break
    }
    act(() => {
      vi.advanceTimersByTime(next - now)
    })
    now = next
    if (nextFrame <= nextTick) {
      queue.shift()!.run()
    } else {
      streamTick()
      nextTick += STREAM_TICK_MS
    }
  }
  act(() => {
    vi.advanceTimersByTime(until - now)
  })
  now = until
}

/** The reader drags the list up into history: finger down, the scroll view
 *  takes the drag past touch slop, and a sample a frame while it moves. */
function dragUp(distance: number): void {
  act(() => latest!.touchStart())
  act(() => latest!.onScrollBeginDrag())
  const steps = 6
  runFor(
    steps * FRAME_MS,
    Array.from({ length: steps }, (_, index) => ({
      at: now + (index + 1) * FRAME_MS,
      run: () => {
        world.y += distance / steps
        act(() => latest!.evaluateEdge(sample(world.y, world.height)))
      }
    }))
  )
}

/** The finger lifts: touch end, then ReactScrollView's ACTION_UP sends end
 *  drag and, always, momentum begin (`handlePostTouchScrolling`). */
function release(): void {
  act(() => latest!.touchEnd())
  act(() => latest!.onScrollEndDrag(sample(world.y, world.height)))
  act(() => latest!.onMomentumScrollBegin())
}

/** A decelerating fling: one sample a frame, each step smaller. `seen`
 *  collects the selection flag as each frame lands. */
function flingFrames(firstStep: number, frames: number, seen: boolean[] = []): Frame[] {
  return Array.from({ length: frames }, (_, index) => ({
    at: now + (index + 1) * FRAME_MS,
    run: () => {
      const step = Math.max(1, firstStep * (1 - index / frames))
      world.y += step
      act(() => latest!.evaluateEdge(sample(world.y, world.height)))
      seen.push(latest!.textSelectable)
    }
  }))
}

describe('holding the agent’s reply to copy it while the reply streams in', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) =>
      setTimeout(() => callback(Date.now()), FRAME_MS)
    )
    vi.stubGlobal('cancelAnimationFrame', (handle: ReturnType<typeof setTimeout>) =>
      clearTimeout(handle)
    )
    list.scrollToOffset.mockClear()
    mount()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    latest = null
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('lets a hold select once the reader’s fling has stopped, while the reply keeps streaming', () => {
    runFor(200)
    expect(latest!.textSelectable).toBe(true)

    dragUp(180)
    expect(latest!.textSelectable).toBe(false)
    release()
    runFor(30 * FRAME_MS, flingFrames(40, 30))
    // The fling has stopped. The reply has not, and no momentum end comes.

    runFor(300)
    expect(latest!.textSelectable).toBe(true)

    // A hold mid-stream: the finger stays put for most of a second.
    act(() => latest!.touchStart())
    runFor(100)
    expect(latest!.textSelectable).toBe(true)
    runFor(350)
    // Past Android's 400 ms long-press mark, with the finger still down.
    expect(latest!.textSelectable).toBe(true)
    runFor(400)
    expect(latest!.textSelectable).toBe(true)
    act(() => latest!.touchEnd())
    runFor(300)
    expect(latest!.textSelectable).toBe(true)
  })

  it('lets a hold select after a drag that let go without a fling, with no momentum end ever sent', () => {
    dragUp(120)
    release()
    // No fling frames: the list stops where the finger left it. Only the
    // stream's place-holding corrections arrive.
    runFor(300)
    expect(latest!.textSelectable).toBe(true)
  })

  it('keeps text unselectable while a fling moves the list mid-stream, and under the finger that stops it', () => {
    dragUp(180)
    release()
    world.coalesce = true
    const seen: boolean[] = []
    runFor(40 * FRAME_MS, flingFrames(40, 40, seen))
    // Every frame of the fling, including those whose event also carried the
    // stream's growth, found the text unselectable.
    expect(seen).toHaveLength(40)
    expect(seen.filter(Boolean)).toEqual([])
    // A finger put down to stop the fling: the scroll view takes it as a
    // drag (Android intercepts a touch-down while a fling runs).
    act(() => latest!.touchStart())
    act(() => latest!.onScrollBeginDrag())
    runFor(2_000)
    // The 2026-09-12 rule: held, not scrolling, and still no selection.
    expect(latest!.textSelectable).toBe(false)
  })

  it('keeps selection on through the re-pins while a hold starts on the streaming reply at the live edge', () => {
    // Following the newest message: the stream re-pins the list, which is
    // already at the edge, so Android sends no scroll at all.
    runFor(300)
    expect(list.scrollToOffset).toHaveBeenCalled()
    expect(latest!.showJumpToLatest).toBe(false)
    // A re-pin that did move the list: a short drag had left it 12 dp up,
    // inside the live-edge slop, so the reader still follows.
    act(() => latest!.touchStart())
    act(() => latest!.onScrollBeginDrag())
    act(() => {
      world.y = 12
      latest!.evaluateEdge(sample(world.y, world.height))
    })
    release()
    runFor(3 * 20 + FRAME_MS, [], false)
    act(() => latest!.onMomentumScrollEnd(sample(world.y, world.height)))
    expect(latest!.showJumpToLatest).toBe(false)
    list.scrollToOffset.mockClear()
    runFor(STREAM_TICK_MS)
    expect(list.scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: false })
    expect(world.y).toBe(0)
    expect(latest!.textSelectable).toBe(true)

    // The hold starts on the streaming reply, mid-stream.
    list.scrollToOffset.mockClear()
    act(() => latest!.touchStart())
    for (const checkpoint of [100, 350, 400, 400]) {
      runFor(checkpoint)
      expect(latest!.textSelectable).toBe(true)
    }
    // Under the finger nothing re-pins, and past the long-press mark the
    // reader owns the list: the anchoring is on, so the selection stays
    // where it was made.
    expect(list.scrollToOffset).not.toHaveBeenCalled()
    expect(latest!.showJumpToLatest).toBe(true)
    act(() => latest!.touchEnd())
    runFor(300)
    expect(latest!.textSelectable).toBe(true)
  })
})
