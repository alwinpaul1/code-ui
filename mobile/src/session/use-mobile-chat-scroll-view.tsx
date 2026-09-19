import { forwardRef, useMemo } from 'react'
import { ScrollView, type ScrollViewProps } from 'react-native'
import { GestureDetector, type ComposedGesture, type GestureType } from 'react-native-gesture-handler'

/** The scroll component FlashList renders, with the pinch gesture attached to
 *  the real ScrollView. FlashList has an outer measurement view; native scroll
 *  recognition must attach to its actual ScrollView, not that wrapper, or
 *  dragging is blocked.
 *
 *  `scrollsChildToFocus` is off: when a long press starts a text selection,
 *  Android asks the nearest ScrollView to bring the focused text on screen,
 *  and the request is computed without the `scaleY: -1` the inverted list
 *  paints with. The list scrolled the wrong way and the selection was gone
 *  before the handles showed (2026-09-19). Nothing in the transcript takes
 *  keyboard focus, so nothing is lost. Android only. */
export function useChatScrollView(pinchGesture: ComposedGesture | GestureType) {
  return useMemo(
    () =>
      forwardRef<ScrollView, ScrollViewProps>(function ChatScrollView(props, ref) {
        return (
          <GestureDetector gesture={pinchGesture}>
            <ScrollView {...props} ref={ref} scrollsChildToFocus={false} />
          </GestureDetector>
        )
      }),
    [pinchGesture]
  )
}
