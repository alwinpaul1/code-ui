import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FlashListRef } from '@shopify/flash-list'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
import {
  useMobileNativeChatTailFollow,
  type MobileNativeChatTailFollow
} from './use-mobile-native-chat-tail-follow'

vi.mock('react-native', () => ({ AppState: { addEventListener: () => ({ remove() {} }) } }))

// The user, 2026-10-14: "when i hold and copy if the scroll the copied part disappears but in
// claude app it doesn't". A hold selected a word of a reply; the first drag of the transcript
// wiped the selection, handles, highlight and Copy pill all gone.
//
// The chat turns `selectable` off for every Text while a scroll is in flight (the 2026-09-12
// stray-selection rule, use-mobile-chat-following.ts), and turning it off is what ends a
// selection on Android: TextView.setTextIsSelectable(false) re-sets the text with no selection
// and stops the action mode, in React Native's Text and in the reply's native prose view alike
// (NativeProseTextView.applyProps). Nothing else in that path touches the selection, so the
// flag the rows draw with is the whole defect, and these tests read it frame by frame.
//
// The Claude app (com.anthropic.claude 1.261009.20) keeps a selection through any scroll: its
// replies are Compose text in a SelectionContainer, whose selection lives in a SelectionState
// that a scroll never touches. The native side of the fix here (SelectionCopyRootView.kt) says
// when a reply holds a selection; while one does, a scroll leaves `selectable` on.

type Row = { id: string; text: string }
type Api = MobileNativeChatTailFollow<Row>

let latest: Api | null = null
function Probe(props: { rows: readonly Row[] }) {
  latest = useMobileNativeChatTailFollow<Row>(props)
  return null
}

const FRAME_MS = 16

function sample(y: number): NativeSyntheticEvent<NativeScrollEvent> {
  return {
    nativeEvent: {
      contentOffset: { x: 0, y },
      contentSize: { width: 400, height: 5000 },
      layoutMeasurement: { width: 400, height: 700 }
    }
  } as NativeSyntheticEvent<NativeScrollEvent>
}

let y = 0
const list = {
  scrollToOffset: vi.fn(({ offset }: { offset: number }) => {
    y = offset
  }),
  scrollToIndex: vi.fn(),
  scrollToEnd: vi.fn()
}

let renderer: ReactTestRenderer | null = null

function mount(rows: readonly Row[]): void {
  y = 0
  act(() => {
    renderer = create(createElement(Probe, { rows }))
  })
  latest!.listRef.current = list as unknown as FlashListRef<Row>
}

/** What the reply's selection root reports (markdown-selection-copy.android.tsx). Called
 *  through `?.` so the unfixed hook, which had no such report, fails on the flag, not a throw. */
function report(owner: object, live: boolean): void {
  act(() => latest!.reportSelection?.(owner, live))
}

/** A hold that selects a word: finger down, Android's 400 ms long-press, the selection's
 *  action mode opens (the report), the finger lifts. */
function holdToSelect(owner: object): void {
  act(() => latest!.touchStart())
  act(() => {
    vi.advanceTimersByTime(450)
  })
  report(owner, true)
  act(() => latest!.touchEnd())
}

/** A drag and the fling after it, as Android sends them (touchcancel before the drag begins,
 *  no touchend after it, momentum begin on release). Returns the flag as each frame drew it. */
function dragAndFling(distance: number): boolean[] {
  const seen: boolean[] = []
  act(() => latest!.touchStart())
  act(() => latest!.touchEnd())
  act(() => latest!.onScrollBeginDrag())
  seen.push(latest!.textSelectable)
  for (let frame = 1; frame <= 6; frame += 1) {
    act(() => {
      vi.advanceTimersByTime(FRAME_MS)
    })
    y += distance / 6
    act(() => latest!.evaluateEdge(sample(y)))
    seen.push(latest!.textSelectable)
  }
  act(() => latest!.onScrollEndDrag(sample(y)))
  act(() => latest!.onMomentumScrollBegin())
  seen.push(latest!.textSelectable)
  for (let frame = 1; frame <= 10; frame += 1) {
    act(() => {
      vi.advanceTimersByTime(FRAME_MS)
    })
    y += 20 - frame
    act(() => latest!.evaluateEdge(sample(y)))
    seen.push(latest!.textSelectable)
  }
  return seen
}

const ONE: Row[] = [{ id: 'a1', text: 'One reply, the only row.' }]
const TWO: Row[] = [
  { id: 'u1', text: 'Is agent session search on the phone?' },
  { id: 'a1', text: 'One thing is out of the phone’s reach.' }
]

describe('a selection held in the chat survives scrolling the transcript', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, FRAME_MS))
    vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id))
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    latest = null
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it.each([
    ['a transcript of one reply', ONE],
    ['a transcript of two messages', TWO]
  ])('keeps the copied words selected while the reader drags and flings %s', (_name, rows) => {
    mount(rows)
    const reply = {}
    holdToSelect(reply)
    const seen = dragAndFling(300)
    // Every frame of the scroll drew the reply selectable, so nothing reset its selection.
    expect(seen.every(Boolean)).toBe(true)
  })

  it('still takes selection off a scroll when nothing is selected (the 2026-09-12 rule)', () => {
    mount(TWO)
    const seen = dragAndFling(300)
    expect(seen[0]).toBe(false)
  })

  it('takes selection off the rest of the scroll once the reader dismisses the selection mid-scroll', () => {
    mount(TWO)
    const reply = {}
    holdToSelect(reply)
    act(() => latest!.touchStart())
    act(() => latest!.touchEnd())
    act(() => latest!.onScrollBeginDrag())
    expect(latest!.textSelectable).toBe(true)
    // The selection's action mode closed (a Copy, a tap away): back to the scroll's rule.
    report(reply, false)
    expect(latest!.textSelectable).toBe(false)
    // And at rest selection returns, as for any scroll.
    act(() => latest!.onScrollEndDrag(sample(y)))
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(latest!.textSelectable).toBe(true)
  })

  it('keeps selection on while another reply still holds one', () => {
    mount(TWO)
    const first = {}
    const second = {}
    holdToSelect(first)
    report(second, true)
    report(first, false)
    expect(dragAndFling(200).every(Boolean)).toBe(true)
  })

  it('ignores the end of a selection it never saw begin', () => {
    mount(ONE)
    report({}, false)
    expect(dragAndFling(200)[0]).toBe(false)
  })
})
