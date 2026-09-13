import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from 'react'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
import type { FlashListRef } from '@shopify/flash-list'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

/** Inside this many px of the live edge the list follows new content again. */
const LIVE_EDGE_THRESHOLD_PX = 40

/** The chat list's scroll handlers: when the reader takes control, when they
 *  hand it back, and when to page in older history. Split from the view so
 *  the view stays under the line ceiling. */
export function useMobileChatScrollHandlers(input: {
  listRef: RefObject<FlashListRef<NativeChatMessage> | null>
  followingRef: MutableRefObject<boolean>
  scrollingRef: MutableRefObject<boolean>
  jumpingRef: MutableRefObject<boolean>
  hasMore?: boolean
  loadingEarlier?: boolean
  onLoadEarlier?: () => void
  setFollowing: (next: boolean) => void
  beginScroll: () => void
  endScroll: () => void
}) {
  const { listRef, followingRef, scrollingRef, jumpingRef, hasMore, loadingEarlier } = input
  const { onLoadEarlier, setFollowing, beginScroll, endScroll } = input
  const settleFrameRef = useRef<number | null>(null)
  const cancelSettle = useCallback(() => {
    if (settleFrameRef.current !== null) {
      cancelAnimationFrame(settleFrameRef.current)
      settleFrameRef.current = null
    }
  }, [])
  useEffect(() => cancelSettle, [cancelSettle])

  const evaluateEdge = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent
      const distanceFromHistoryStart =
        contentSize.height - (contentOffset.y + layoutMeasurement.height)
      if (!scrollingRef.current && contentOffset.y < LIVE_EDGE_THRESHOLD_PX) {
        setFollowing(true)
      }
      // Near the top — page in older history.
      if (!followingRef.current && distanceFromHistoryStart < 60 && hasMore && !loadingEarlier) {
        onLoadEarlier?.()
      }
    },
    [hasMore, loadingEarlier, onLoadEarlier, setFollowing]
  )

  // FlashList's own end-of-content signal, which in an inverted list is the
  // start of history. The scroll-sample check above missed a fast fling that
  // came to rest on the last loaded row (2026-09-13, on the device: the list
  // stopped dead until the invisible row was tapped).
  const onEndReached = useCallback(() => {
    if (!followingRef.current && hasMore && !loadingEarlier) {
      onLoadEarlier?.()
    }
  }, [followingRef, hasMore, loadingEarlier, onLoadEarlier])

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
      evaluateEdge({ nativeEvent: metrics } as NativeSyntheticEvent<NativeScrollEvent>)
    },
    [evaluateEdge, endScroll]
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
  }, [beginScroll, cancelSettle, jumpingRef])

  const onMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      cancelSettle()
      jumpingRef.current = false
      settle(event.nativeEvent)
    },
    [cancelSettle, jumpingRef, settle]
  )

  const jumpToLatest = useCallback(
    (animated: boolean) => {
      cancelSettle()
      jumpingRef.current = true
      setFollowing(true)
      listRef.current?.scrollToOffset({ offset: 0, animated })
    },
    [cancelSettle, jumpingRef, listRef, setFollowing]
  )

  // Align a single message's top to the top of the viewport.
  const onScrollToMessage = useCallback(
    (index: number) => {
      setFollowing(false)
      listRef.current?.scrollToIndex({ index, viewPosition: 1, animated: true })
    },
    [listRef, setFollowing]
  )

  return {
    evaluateEdge,
    onEndReached,
    onScrollBeginDrag,
    onScrollEndDrag,
    onMomentumScrollBegin,
    onMomentumScrollEnd,
    jumpToLatest,
    onScrollToMessage
  }
}
