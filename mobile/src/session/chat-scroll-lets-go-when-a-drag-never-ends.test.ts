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

/** React Native's AppState, as far as the chat reads it. */
const appState = vi.hoisted(() => {
  const listeners = new Map<string, Set<(state?: string) => void>>()
  return {
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

// "Scrolling sometimes gets stuck" while Claude worked (the user, 2026-10-17). The phone's
// [chat-scroll] log held 4 drags out of 50 with a "drag start" and no "drag end", ever.
// ReactScrollView (RN 0.86.3, ReactScrollView.java:656) sends its end-drag only for ACTION_UP;
// an ACTION_CANCEL — the system taking the touch, or gesture-handler cancelling the list's Native
// gesture (NativeViewGestureHandler.kt:153-162 sends one) — leaves the drag open with no end, no
// fling and no momentum. The Claude app's list ends a drag when its drag interaction stops OR is
// cancelled, so a cancel ends it here as a lift does. The event orders below are what Android
// sends: JS's touchcancel lands with the drag's start (the scroll view took the touch), and no
// touch event follows.

type Row = { id: string }
let latest: MobileNativeChatTailFollow<Row> | null = null

function Probe(props: { rows: readonly Row[] }) {
  latest = useMobileNativeChatTailFollow<Row>(props)
  return null
}

function at(y: number, height = 2400): NativeSyntheticEvent<NativeScrollEvent> {
  return {
    nativeEvent: { contentOffset: { y }, contentSize: { height }, layoutMeasurement: { height: 400 } }
  } as NativeSyntheticEvent<NativeScrollEvent>
}

type InfoSpy = { mock: { calls: unknown[][] }; mockRestore: () => void }

function scrollLines(info: InfoSpy): string[] {
  return info.mock.calls.map((call: unknown[]) => String(call[0])).filter((line: string) => line.startsWith('[chat-scroll]'))
}

function missingLines(info: InfoSpy): string[] {
  return scrollLines(info).filter((line) => line.includes('drag end missing'))
}

describe('a drag whose end never comes', () => {
  let renderer: ReactTestRenderer | null = null
  let info: InfoSpy
  const list = { scrollToOffset: vi.fn(), scrollToEnd: vi.fn(), scrollToIndex: vi.fn() }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 16) as unknown as number)
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
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
    vi.useRealTimers()
  })

  /** A drag that starts while following, as Android orders it, and moves the list a little. */
  function dragFromTheTail(y: number): void {
    act(() => latest!.touchStart())
    act(() => latest!.touchEnd())
    act(() => latest!.onScrollBeginDrag())
    act(() => latest!.evaluateEdge(at(y)))
  }

  function wait(ms: number): void {
    act(() => {
      vi.advanceTimersByTime(ms)
    })
  }

  it('lets go of the list when a drag never reports its end', () => {
    dragFromTheTail(12)
    expect(latest!.detachedFromTail).toBe(true)
    expect(latest!.textSelectable).toBe(false)

    // Gesture-handler cancelled the list's scroll: the gesture ends, the scroll view sends nothing.
    act(() => latest!.scrollGestureEnded(true))
    wait(MISSING_DRAG_END_GRACE_MS + 50)

    // Settled as a lift settles: at the tail, so following again, and the text selectable.
    expect(latest!.detachedFromTail).toBe(false)
    expect(latest!.textSelectable).toBe(true)
    expect(missingLines(info)).toEqual(["[chat-scroll] drag end missing, ended by the scroll gesture's cancel"])

    // The stream follows again: new data pins the newest message.
    act(() => renderer!.update(createElement(Probe, { rows: [{ id: 'a1' }, { id: 'a2' }] })))
    act(() => latest!.pinToTailAfterContentResize(400, 2600))
    expect(list.scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: false })
  })

  it('keeps the reader in history when a drag up there is cancelled', () => {
    dragFromTheTail(900)
    act(() => latest!.scrollGestureEnded(true))
    wait(MISSING_DRAG_END_GRACE_MS + 50)

    expect(latest!.detachedFromTail).toBe(true)
    expect(latest!.showJumpToLatest).toBe(true)
    expect(latest!.textSelectable).toBe(true)
    act(() => latest!.pinToTailAfterContentResize(400, 2600))
    expect(list.scrollToOffset).not.toHaveBeenCalled()
  })

  // The gesture's end reaches JS as a device event, the scroll view's end-drag a frame later.
  it('waits for a plain lift to report its own end, and says nothing is missing', () => {
    dragFromTheTail(12)
    act(() => latest!.scrollGestureEnded(false))
    act(() => latest!.onScrollEndDrag(at(14)))
    act(() => latest!.onMomentumScrollBegin())
    wait(MISSING_DRAG_END_GRACE_MS + 50)

    expect(missingLines(info)).toEqual([])
    // A flick at the live edge is still flinging: the list stays the reader's.
    expect(latest!.detachedFromTail).toBe(true)
  })

  it('ends a drag with no end at the fling that follows it', () => {
    dragFromTheTail(300)
    act(() => latest!.onMomentumScrollBegin())

    expect(missingLines(info)).toEqual(["[chat-scroll] drag end missing, ended by the fling's start"])
    // The gesture's end that comes after it finds no drag to end.
    act(() => latest!.scrollGestureEnded(false))
    wait(MISSING_DRAG_END_GRACE_MS + 50)
    expect(missingLines(info)).toHaveLength(1)
  })

  it('never holds a drag open across touches', () => {
    dragFromTheTail(300)
    act(() => latest!.touchStart())

    expect(missingLines(info)).toEqual(['[chat-scroll] drag end missing, ended by the next touch down'])
    // The new finger owns the list now; it lifts with no drag and the list comes to rest.
    act(() => latest!.touchEnd())
    wait(300)
    expect(latest!.textSelectable).toBe(true)
  })

  // The four open drags of the 2026-10-17 log: each was followed about a second later by the
  // app leaving the foreground (the background link started listening), a back or home swipe
  // that began on the list.
  it('names the app leaving the foreground as what ended an open drag', () => {
    dragFromTheTail(12)
    act(() => appState.emit('change', 'background'))

    expect(missingLines(info)).toEqual(['[chat-scroll] drag end missing, ended by the app leaving the foreground'])
  })

  it('says nothing is missing when the gesture of a tap ends', () => {
    act(() => latest!.touchStart())
    act(() => latest!.touchEnd())
    act(() => latest!.scrollGestureEnded(false))
    wait(MISSING_DRAG_END_GRACE_MS + 50)

    expect(missingLines(info)).toEqual([])
  })
})
