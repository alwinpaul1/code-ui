import { useCallback, type MutableRefObject } from 'react'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'

/** Inside this many px of the live edge the list follows new content again. */
const LIVE_EDGE_THRESHOLD_PX = 40

/** The chat list's scroll handlers: when the reader takes control, when they
 *  hand it back, and when to page in older history. Split from the view so
 *  the view stays under the line ceiling. */
export function useMobileChatScrollHandlers(input: {
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
  const { followingRef, scrollingRef, jumpingRef, hasMore, loadingEarlier, onLoadEarlier } = input
  const { setFollowing, beginScroll, endScroll } = input
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

  // The reader took control: stop following immediately, on the same frame as
  // the drag, not after the next scroll sample lands.
  const onScrollBeginDrag = useCallback(() => {
    jumpingRef.current = false
    beginScroll()
  }, [beginScroll])

  const onScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      endScroll()
      evaluateEdge(event)
    },
    [evaluateEdge, endScroll]
  )


  return { evaluateEdge, onScrollBeginDrag, onScrollEnd }
}
