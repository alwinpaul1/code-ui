import { forwardRef, useMemo } from 'react'
import { ScrollView, type ScrollViewProps } from 'react-native'
import { GestureDetector, type ComposedGesture, type GestureType } from 'react-native-gesture-handler'

/** The scroll component FlashList renders, with the pinch gesture attached to
 *  the real ScrollView. FlashList has an outer measurement view; native scroll
 *  recognition must attach to its actual ScrollView, not that wrapper, or
 *  dragging is blocked. */
export function useChatScrollView(pinchGesture: ComposedGesture | GestureType) {
  return useMemo(
    () =>
      forwardRef<ScrollView, ScrollViewProps>(function ChatScrollView(props, ref) {
        return (
          <GestureDetector gesture={pinchGesture}>
            <ScrollView {...props} ref={ref} />
          </GestureDetector>
        )
      }),
    [pinchGesture]
  )
}
