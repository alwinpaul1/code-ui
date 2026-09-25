import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FlashListRef } from '@shopify/flash-list'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
import {
  useMobileNativeChatTailFollow,
  type MobileNativeChatTailFollow
} from './use-mobile-native-chat-tail-follow'

/** React Native's AppState, as far as the chat reads it: the app leaving the
 *  foreground, and its window losing focus (Android's `blur`). */
const appState = vi.hoisted(() => {
  const listeners = new Map<string, Set<(state?: string) => void>>()
  return {
    listeners,
    addEventListener(type: string, listener: (state?: string) => void) {
      const set = listeners.get(type) ?? new Set()
      set.add(listener)
      listeners.set(type, set)
      return { remove: () => set.delete(listener) }
    },
    emit(type: string, state?: string) {
      for (const listener of listeners.get(type) ?? []) {
        listener(state)
      }
    }
  }
})
vi.mock('react-native', () => ({ AppState: { addEventListener: appState.addEventListener } }))

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
// - While the reader is off the live edge and the streaming reply is wholly
//   past them, FlashList holds their place (`maintainVisibleContentPosition`,
//   on whenever the jump control shows): its ScrollAnchor moves by exactly
//   what the rows above grew, and the native helper scrolls by the same
//   amount. The list sends an `onScroll` for each correction, with the
//   offset AND the content height moved by that growth. While the reply is
//   itself the first visible row, its growth moves nothing to correct.
// - ReactScrollView sets `mActivelyScrolling` on every `onScrollChanged`,
//   corrections included, and sends `onMomentumScrollEnd` only after three
//   post-touch checks (20 ms apart) with no scroll change. A correction
//   every 50 ms never leaves that gap, so the end never comes while the
//   reply streams.
// - When the scroll view takes a gesture (ReactScrollView
//   .handleInterceptedTouchEvent -> NativeGestureUtil
//   .notifyNativeGestureStarted; the flag that skips it,
//   shouldTriggerResponderTransferOnScrollAndroid, is off), JS gets a
//   touchcancel BEFORE onScrollBeginDrag, and no touchend when that finger
//   lifts. The chat list routes onTouchCancel to touchEnd. A finger put down
//   during a fling is taken at ACTION_DOWN (mIsBeingDragged =
//   !mScroller.isFinished()). A still finger on text is never taken.
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
/** Where the streaming reply ends, measured up from the live edge: the dock
 *  spacer and turn status below it, then the reply itself. */
const REPLY_END_DP = 160

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
const world = { y: 0, height: 5000, streamed: 0, replyEnd: REPLY_END_DP, coalesce: false }

/** Every re-pin the hook asked for, by time. */
const pins: number[] = []

/** What the native list does when the hook asks it to move: it moves, and
 *  reports a scroll only if it actually went somewhere. */
const list = {
  scrollToOffset: vi.fn(({ offset }: { offset: number }) => {
    pins.push(now)
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

function mount(y = 0): void {
  world.y = y
  world.height = 5000
  world.streamed = 0
  world.replyEnd = REPLY_END_DP
  world.coalesce = false
  now = 0
  pins.length = 0
  act(() => {
    renderer = create(createElement(Probe, { rows: rows() }))
  })
  latest!.listRef.current = list as unknown as FlashListRef<Row>
}

/** One stream tick: the reply grows a line, the list re-measures, and the
 *  native side answers — a re-pin while following, a place-holding
 *  correction while the reply is wholly past the reader. */
function streamTick(): void {
  world.streamed += 1
  act(() => renderer!.update(createElement(Probe, { rows: rows() })))
  act(() => {
    const replyPastReader = world.y > world.replyEnd
    world.height += LINE_DP
    world.replyEnd += LINE_DP
    // FlashList's onContentSizeChange: the only NEW-data follow path.
    latest!.pinToTailAfterContentResize(400, world.height)
    if (latest!.showJumpToLatest && replyPastReader) {
      world.y += LINE_DP
      if (!(world.coalesce && world.streamed % 2 === 0)) {
        latest!.evaluateEdge(sample(world.y, world.height))
      }
    }
  })
}

type Frame = { at: number; run: () => void }

/** Runs the stream alongside `frames` for `ms`, in time order. `probe`, if
 *  given, runs once a frame, to read the flag as the list would draw it. */
function runFor(ms: number, frames: Frame[] = [], stream = true, probe?: () => void): void {
  const until = now + ms
  const queue = [...frames].sort((left, right) => left.at - right.at)
  let nextTick = stream ? Math.ceil((now + 1) / STREAM_TICK_MS) * STREAM_TICK_MS : Infinity
  let nextProbe = probe ? now + FRAME_MS : Infinity
  for (;;) {
    const nextFrame = queue[0]?.at ?? Infinity
    const next = Math.min(nextTick, nextFrame, nextProbe)
    if (next > until) {
      break
    }
    act(() => {
      vi.advanceTimersByTime(next - now)
    })
    now = next
    if (next === nextFrame) {
      queue.shift()!.run()
    } else if (next === nextTick) {
      streamTick()
      nextTick += STREAM_TICK_MS
    } else {
      probe!()
      nextProbe += FRAME_MS
    }
  }
  act(() => {
    vi.advanceTimersByTime(until - now)
  })
  now = until
}

/** The scroll view takes the gesture: JS sees touchcancel (routed to
 *  touchEnd), then onScrollBeginDrag. */
function intercept(): void {
  act(() => latest!.touchEnd())
  act(() => latest!.onScrollBeginDrag())
}

/** A sample a frame while a finger moves the list by `distance`. */
function moveFrames(distance: number, steps: number): void {
  runFor(
    steps * FRAME_MS,
    Array.from({ length: steps }, (_, index) => ({
      at: now + (index + 1) * FRAME_MS,
      run: () => {
        world.y = Math.max(0, world.y + distance / steps)
        act(() => latest!.evaluateEdge(sample(world.y, world.height)))
      }
    }))
  )
}

/** The reader drags the list: finger down, the scroll view takes it past
 *  touch slop, and a sample a frame while it moves. */
function drag(distance: number, steps = 6): void {
  act(() => latest!.touchStart())
  intercept()
  moveFrames(distance, steps)
}

/** The finger lifts: no touchend reaches JS; ReactScrollView's ACTION_UP
 *  sends end drag and, always, momentum begin (`handlePostTouchScrolling`). */
function release(): void {
  act(() => latest!.onScrollEndDrag(sample(world.y, world.height)))
  act(() => latest!.onMomentumScrollBegin())
}

/** A decelerating fling: one sample a frame, each step smaller. `seen`
 *  collects the selection flag as each frame lands. */
function flingFrames(firstStep: number, frames: number, seen: boolean[] = []): Frame[] {
  return Array.from({ length: frames }, (_, index) => ({
    at: now + (index + 1) * FRAME_MS,
    run: () => {
      const step = Math.max(1, Math.abs(firstStep) * (1 - index / frames))
      world.y = Math.max(0, world.y + Math.sign(firstStep) * step)
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
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    latest = null
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('lets a hold select once the reader’s fling has stopped, while the reply keeps streaming', () => {
    mount()
    runFor(200)
    expect(latest!.textSelectable).toBe(true)

    drag(180)
    expect(latest!.textSelectable).toBe(false)
    release()
    runFor(30 * FRAME_MS, flingFrames(40, 30))
    // The fling has stopped. The reply has not, and no momentum end comes.
    expect(world.y).toBeGreaterThan(world.replyEnd)

    runFor(300)
    expect(latest!.textSelectable).toBe(true)

    // A hold mid-stream: a still finger on text, which the scroll view never
    // takes, so JS sees its touchend.
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
    mount()
    drag(400)
    release()
    // No fling frames: the list stops where the finger left it. Only the
    // stream's place-holding corrections arrive.
    expect(world.y).toBeGreaterThan(world.replyEnd)
    runFor(300)
    expect(latest!.textSelectable).toBe(true)
  })

  it('keeps text unselectable while a fling moves the list mid-stream', () => {
    mount()
    drag(180)
    release()
    world.coalesce = true
    const seen: boolean[] = []
    runFor(40 * FRAME_MS, flingFrames(40, 40, seen))
    // Every frame of the fling, including those whose event also carried the
    // stream's growth, found the text unselectable.
    expect(seen).toHaveLength(40)
    expect(seen.filter(Boolean)).toEqual([])
  })

  // Second review of the fix, 2026-09-25: with the touchcancel Android sends,
  // the first version of this fix opened the quiet window when the scroll
  // view took the finger, and the text turned selectable 250 ms into a hold
  // that had caught a fling.
  for (const stream of [true, false]) {
    it(`keeps text unselectable under the finger that catches a fling and holds still (stream ${stream ? 'on' : 'off'})`, () => {
      mount()
      drag(400)
      release()
      runFor(10 * FRAME_MS, flingFrames(40, 30), stream)
      // The finger comes down while the fling still runs: taken at DOWN.
      act(() => latest!.touchStart())
      intercept()
      const held: boolean[] = []
      runFor(2_000, [], stream, () => held.push(latest!.textSelectable))
      // The 2026-09-12 rule: held, not scrolling, and still no selection.
      expect(held.length).toBeGreaterThan(100)
      expect(held.filter(Boolean)).toEqual([])
      // It lifts, and the list is at rest: selection comes back by itself.
      release()
      runFor(300, [], stream)
      expect(latest!.textSelectable).toBe(true)
    })
  }

  // Same review: once the window had closed under that finger, the scroll
  // counted as over, the first drag sample near the live edge handed the
  // list back to tail-follow, and every stream tick pinned it to the newest
  // message while the reader was dragging away from it.
  it('does not pull the list to the newest message while the reader drags up after catching a fling near it', () => {
    mount(600)
    drag(-200)
    release()
    runFor(
      12 * FRAME_MS,
      Array.from({ length: 12 }, (_, index) => ({
        at: now + (index + 1) * FRAME_MS,
        run: () => {
          world.y = Math.max(20, world.y - 40)
          act(() => latest!.evaluateEdge(sample(world.y, world.height)))
        }
      }))
    )
    expect(world.y).toBe(20)
    // Caught 20 dp from the live edge; the finger stays down, then drags up.
    act(() => latest!.touchStart())
    intercept()
    runFor(400)
    const pinsBefore = pins.length
    moveFrames(300, 20)
    expect(pins.length - pinsBefore).toBe(0)
    expect(world.y).toBeGreaterThan(300)
    expect(latest!.showJumpToLatest).toBe(true)
  })

  // Same review, and older than the fix: a drag that pauses for a quarter of
  // a second with the finger down closed the window the same way.
  it('does not pull the list to the newest message when a drag near it pauses and goes on', () => {
    mount()
    runFor(200)
    drag(20, 4)
    runFor(400)
    const pinsBefore = pins.length
    moveFrames(300, 20)
    expect(pins.length - pinsBefore).toBe(0)
    expect(world.y).toBeGreaterThan(300)
    expect(latest!.showJumpToLatest).toBe(true)
  })

  // Third review, 2026-09-25: a drag lasts until its end event, and Android
  // sends none when the system takes the touch mid-drag (ACTION_CANCEL: a
  // home swipe, a call, the screen locking) and JS gets no touch event
  // either. The text then stayed unselectable, and the first hold back in
  // the app selected nothing. Each of those takes the app out of the
  // foreground or its window's focus, which AppState reports.
  for (const [label, interrupt] of [
    ['the app goes to the background', () => appState.emit('change', 'background')],
    ['the app’s window loses focus', () => appState.emit('blur')]
  ] as const) {
    it(`gives selection back to the first hold after the system takes a drag mid-way, when ${label}`, () => {
      mount(600)
      drag(120)
      // The system took the touch: no end drag, no touch event, nothing.
      act(() => interrupt())
      runFor(300)
      act(() => appState.emit('change', 'active'))
      runFor(STREAM_TICK_MS)
      expect(latest!.textSelectable).toBe(true)
      // The first hold back in the app, probed a frame at a time.
      act(() => latest!.touchStart())
      const held: boolean[] = []
      runFor(900, [], true, () => held.push(latest!.textSelectable))
      expect(held.length).toBeGreaterThan(50)
      expect(held.filter((selectable) => !selectable)).toEqual([])
      act(() => latest!.touchEnd())
    })
  }

  it('costs at most the next touch when a drag’s end never comes and nothing reports why', () => {
    mount(600)
    drag(120)
    runFor(1_000)
    // Stranded: nothing says the finger is gone. The next touch does.
    expect(latest!.textSelectable).toBe(false)
    act(() => latest!.touchStart())
    act(() => latest!.touchEnd())
    runFor(300)
    expect(latest!.textSelectable).toBe(true)
  })

  it('keeps selection on through the re-pins while a hold starts on the streaming reply at the live edge', () => {
    mount()
    // Following the newest message: the stream re-pins the list, which is
    // already at the edge, so Android sends no scroll at all.
    runFor(300)
    expect(list.scrollToOffset).toHaveBeenCalled()
    expect(latest!.showJumpToLatest).toBe(false)
    // A re-pin that did move the list: a short drag had left it 12 dp up,
    // inside the live-edge slop, so the reader still follows.
    drag(12, 1)
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
