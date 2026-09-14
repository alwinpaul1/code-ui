import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
import type { FlashListRef } from '@shopify/flash-list'
import { useMobileChatFollowing } from './use-mobile-chat-following'

/** Inside this many px of the live edge the list counts as at the tail.
 *
 *  The list is INVERTED: its tail — the newest message — is the constant
 *  offset 0, so being at the tail is a small offset and nothing else. Upstream
 *  measures 80px up from the bottom of a non-inverted list's content, which is
 *  a number that moves with every token; this 40px was tuned on the device
 *  against an offset that never moves. */
const AT_TAIL_SLOP_PX = 40

/** Inside this many px of the far end — which in an inverted list is the start
 *  of loaded history — page in older messages. */
const HISTORY_START_SLOP_PX = 60

/** Geometry, and only geometry: where the list is, never what the reader
 *  wants. */
function isAtTail(metrics: NativeScrollEvent): boolean {
  return metrics.contentOffset.y < AT_TAIL_SLOP_PX
}

function isAtHistoryStart(metrics: NativeScrollEvent): boolean {
  const { contentOffset, contentSize, layoutMeasurement } = metrics
  return contentSize.height - (contentOffset.y + layoutMeasurement.height) < HISTORY_START_SLOP_PX
}

export type MobileNativeChatTailFollow<TItem> = {
  /** Attach to the transcript list; the hook scrolls through this ref alone. */
  listRef: RefObject<FlashListRef<TItem> | null>
  /** Render flag for the jump-to-latest control, and for history anchoring. */
  showJumpToLatest: boolean
  /** Off while a scroll is in flight, so Android cannot arm a text-selection
   *  long-press under the moving rows. */
  textSelectable: boolean
  touchStart: () => void
  touchEnd: () => void
  /** Every scroll sample: records geometry, pages history at the far end. */
  evaluateEdge: (event: NativeSyntheticEvent<NativeScrollEvent>) => void
  onEndReached: () => void
  onScrollBeginDrag: () => void
  onScrollEndDrag: (event: NativeSyntheticEvent<NativeScrollEvent>) => void
  onMomentumScrollBegin: () => void
  onMomentumScrollEnd: (event: NativeSyntheticEvent<NativeScrollEvent>) => void
  /** Passive maintenance: re-pin after the viewport or the dock resizes. */
  pinToTail: () => void
  /** Content-size maintenance, gated so only NEW data may pull the list. */
  pinToTailAfterContentResize: (width: number, height: number) => void
  /** Explicit jump — the jump-to-latest control. Resumes following. */
  jumpToTail: (animated: boolean) => void
  /** Align one message's top to the top of the viewport; hands the list to the
   *  reader, since the agent's streaming must not move what they jumped to. */
  onScrollToMessage: (index: number) => void
  /** Leave the tail deliberately, e.g. before paging in older history. */
  detachFromTail: () => void
}

/** Sole owner of the chat transcript's scroll position.
 *
 *  Ported from Orca 2fc84cb49 (#20493) and adapted to this fork's INVERTED
 *  FlashList. Upstream's list is non-inverted, so its tail is a measured
 *  content height and it pins with `scrollToEnd` / `scrollToOffset({ offset:
 *  measuredHeight })`; here the tail is the constant offset 0, which is why
 *  `pinToTailAfterContentResize` takes the measured height the list hands it
 *  and ignores it. Everything else upstream is about — one writer, intent kept
 *  apart from geometry, and a released finger not counting as a settled list —
 *  transfers unchanged.
 *
 *  Streaming used to have several tail-followers at once, and the visible
 *  symptom was drift-then-snap. Here the same disease showed up as several
 *  owners of `listRef`: the view pinned on content growth, the dock hook pinned
 *  on its own height, and the scroll handlers jumped. One owner instead: no
 *  caller outside this hook touches the list's scroll position.
 *
 *  Intent (`following`) is kept apart from geometry (`atTail`). A programmatic
 *  scroll reports metrics like any other, so letting metrics decide intent lets
 *  the view argue with itself. Only the reader's own gestures, a long-press and
 *  explicit jumps move intent; metrics decide only where a RELEASED gesture
 *  leaves us, and whether a settled list sits at the live edge.
 *
 *  What this fork keeps that upstream has no counterpart for: the reader's hold
 *  and long-press ownership and the text-selection flag that rides with it (see
 *  `use-mobile-chat-following.ts`), the new-data-only follow gate (see
 *  `mobile-chat-follow-gate.ts`), and a jump-to-latest control that rises the
 *  instant a drag starts rather than waiting for the list to leave the tail. */
export function useMobileNativeChatTailFollow<TItem>(input: {
  /** The list's rows. Their identity arms the follow gate; their emptiness
   *  guards every pin, as upstream's `hasItems` does. */
  rows: readonly TItem[]
  hasMore?: boolean
  loadingEarlier?: boolean
  onLoadEarlier?: () => void
}): MobileNativeChatTailFollow<TItem> {
  const { rows, hasMore, loadingEarlier, onLoadEarlier } = input
  const hasItems = rows.length > 0
  const listRef = useRef<FlashListRef<TItem>>(null)
  const jumpingRef = useRef(false)
  // Geometry. A ref, not state: this fork raises the jump-to-latest control on
  // intent alone, so nothing renders off where the list happens to sit.
  const atTailRef = useRef(true)
  const settleFrameRef = useRef<number | null>(null)
  // Intent is a ref as well as a render flag, and the handlers read the ref:
  // a content-size change arrives before React commits the flag, and reading
  // the committed value there yanked the list back down mid-read (#11638).
  // `use-mobile-chat-following.ts` is its single writer, as upstream's
  // `setFollowing` is.
  const {
    followingRef,
    scrollingRef,
    holdingRef,
    touchStart,
    touchEnd,
    followGate,
    textSelectable,
    showJumpToLatest,
    setFollowing,
    beginScroll,
    endScroll
  } = useMobileChatFollowing()
  followGate.noteData(rows)

  // Single writer for geometry, as `setFollowing` is for intent.
  const setAtTail = useCallback((next: boolean) => {
    atTailRef.current = next
  }, [])

  const cancelSettle = useCallback(() => {
    if (settleFrameRef.current !== null) {
      cancelAnimationFrame(settleFrameRef.current)
      settleFrameRef.current = null
    }
  }, [])
  useEffect(() => cancelSettle, [cancelSettle])

  // The one place the list is told where to sit. Never animated: an animated
  // command eases toward the endpoint measured when it started, so while
  // tokens keep arriving it runs backwards until the next pin yanks it forward.
  //
  // Guards on `holding` as well as `following`, so the dock re-pin and the
  // list's own onLayout — which both reach this directly — cannot yank the
  // transcript out from under a held finger (the select-text-and-jump symptom).
  // It must NOT consult the follow gate: that gate consumes a pending-data flag
  // so a re-measure cannot follow, but a dock or keyboard re-pin legitimately
  // fires with no new data and still has to keep the newest row above the dock
  // (2026-09-14: gating this on new data hid the newest message under the
  // keyboard whenever the reader tapped the composer of an idle agent).
  const pinToTail = useCallback(() => {
    if (!followingRef.current || !hasItems || holdingRef.current) {
      return
    }
    listRef.current?.scrollToOffset({ offset: 0, animated: false })
  }, [followingRef, hasItems, holdingRef])

  const pinToTailAfterContentResize = useCallback(
    (_width: number, _height: number) => {
      if (!hasItems) {
        return
      }
      // Upstream pins at the height the list just measured. An inverted list
      // needs neither number: its tail is offset 0 whatever the content does.
      // Only NEW data may follow here: the gate consumes the pending change so a
      // re-measure (selection handles, a font pinch) does not pull the reader to
      // the newest message. `pinToTail` then applies the holding/following guard.
      if (followGate.shouldFollow(followingRef.current, holdingRef.current)) {
        pinToTail()
      }
    },
    [followGate, followingRef, hasItems, holdingRef, pinToTail]
  )

  const detachFromTail = useCallback(() => {
    setAtTail(false)
    setFollowing(false)
  }, [setAtTail, setFollowing])

  // Upstream detaches before a prepend resizes the list under the reader. An
  // inverted list appends older rows past the far end, so its tail does not
  // move and this is inert at the only edge that reaches it — the reader is
  // already off the tail by the time history pages in. Kept because the
  // contract is what stops the next caller from paging while pinned.
  const loadEarlier = useCallback(() => {
    detachFromTail()
    onLoadEarlier?.()
  }, [detachFromTail, onLoadEarlier])

  const applyMetrics = useCallback(
    (metrics: NativeScrollEvent) => {
      setAtTail(isAtTail(metrics))
      // A gesture in flight owns the list; only a settled one may hand it back.
      if (!scrollingRef.current && atTailRef.current) {
        setFollowing(true)
      }
      // Near the far end — page in older history.
      if (!followingRef.current && isAtHistoryStart(metrics) && hasMore && !loadingEarlier) {
        loadEarlier()
      }
    },
    [followingRef, hasMore, loadEarlier, loadingEarlier, scrollingRef, setAtTail, setFollowing]
  )

  const evaluateEdge = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => applyMetrics(event.nativeEvent),
    [applyMetrics]
  )

  // FlashList's own end-of-content signal, which in an inverted list is the
  // start of history. The scroll-sample check above missed a fast fling that
  // came to rest on the last loaded row (2026-09-13, on the device: the list
  // stopped dead until the invisible row was tapped).
  const onEndReached = useCallback(() => {
    if (!followingRef.current && hasMore && !loadingEarlier) {
      loadEarlier()
    }
  }, [followingRef, hasMore, loadEarlier, loadingEarlier])

  // The reader took control: stop following immediately, on the same frame as
  // the drag, not after the next scroll sample lands.
  const onScrollBeginDrag = useCallback(() => {
    cancelSettle()
    jumpingRef.current = false
    beginScroll()
  }, [beginScroll, cancelSettle])

  const settle = useCallback(
    (metrics: NativeScrollEvent) => {
      endScroll()
      applyMetrics(metrics)
    },
    [applyMetrics, endScroll]
  )

  // Ported from Orca 2fc84cb49 (#20493): a released finger is not a settled
  // list. A flick that starts at the live edge lets go still inside the 40px
  // threshold, and the momentum that follows carries the reader up into
  // history — so settling at the release point handed the list back to
  // tail-follow for the length of the fling, and a token arriving in that
  // window yanked the reader down. Wait a frame instead; momentum, when it
  // comes, cancels the wait and where it lands decides.
  const onScrollEndDrag = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      cancelSettle()
      const metrics = event.nativeEvent
      settleFrameRef.current = requestAnimationFrame(() => {
        settleFrameRef.current = null
        settle(metrics)
      })
    },
    [cancelSettle, settle]
  )

  // A requested jump also emits momentum events. Enabling history anchoring
  // during that animation interrupts it before the end.
  const onMomentumScrollBegin = useCallback(() => {
    cancelSettle()
    if (!jumpingRef.current) {
      beginScroll()
    }
  }, [beginScroll, cancelSettle])

  const onMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      cancelSettle()
      jumpingRef.current = false
      settle(event.nativeEvent)
    },
    [cancelSettle, settle]
  )

  const jumpToTail = useCallback(
    (animated: boolean) => {
      cancelSettle()
      jumpingRef.current = true
      setAtTail(true)
      setFollowing(true)
      listRef.current?.scrollToOffset({ offset: 0, animated })
    },
    [cancelSettle, setAtTail, setFollowing]
  )

  const onScrollToMessage = useCallback(
    (index: number) => {
      detachFromTail()
      listRef.current?.scrollToIndex({ index, viewPosition: 1, animated: true })
    },
    [detachFromTail]
  )

  return {
    listRef,
    showJumpToLatest,
    textSelectable,
    touchStart,
    touchEnd,
    evaluateEdge,
    onEndReached,
    onScrollBeginDrag,
    onScrollEndDrag,
    onMomentumScrollBegin,
    onMomentumScrollEnd,
    pinToTail,
    pinToTailAfterContentResize,
    jumpToTail,
    onScrollToMessage,
    detachFromTail
  }
}
