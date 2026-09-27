import { useMemo } from 'react'
import { Gesture } from 'react-native-gesture-handler'
import type Animated from 'react-native-reanimated'
import {
  runOnJS,
  scrollTo,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue
} from 'react-native-reanimated'
import type { ExpandableSheetSettle } from './bottom-drawer-expandable'
import { DRAWER_SPRING } from './drawer-spring'

const DISMISS_THRESHOLD = 80
// Why: negative translateY (pulling up) is damped with a rubber-band factor
// so the drawer resists upward dragging — a subtle polish touch that signals
// the drawer cannot expand further.
const RUBBER_BAND_FACTOR = 0.25
const TOP_SCROLL_EPSILON = 1

/**
 * The drawer's three gestures, built once: the handle's pan (and the pinned
 * header's), the content's pan, and the content list's own native scroll.
 * `translateY` is where the sheet stands below its top rest; the content's pan
 * hands a drag to the list while the list has rows above its top, and takes
 * it back once the list is at its top.
 *
 * Why every gesture is memoised: the drawer re-renders on every streamed
 * message and the tasks sheet's clock re-renders its rows each second; a new
 * `Gesture.Pan()` per render makes gesture-handler reconfigure the handler it
 * is tracking the finger with, mid-drag.
 */
export function useBottomDrawerDrag(args: {
  expandable: boolean
  /** Whether the content is the Animated.ScrollView this hook's ref is on. */
  hasList: boolean
  screenHeight: number
  translateY: SharedValue<number>
  progress: SharedValue<number>
  sheet: {
    begin: () => void
    drag: (translationY: number) => void
    release: (velocityY: number) => ExpandableSheetSettle
    listScrolls: SharedValue<boolean>
  }
  /** Stable for the drawer's life. */
  close: () => void
}) {
  const { expandable, hasList, screenHeight, translateY, progress, close } = args
  const { begin, drag, release, listScrolls } = args.sheet
  const scrollRef = useAnimatedRef<Animated.ScrollView>()
  const scrollOffsetY = useSharedValue(0)
  const contentDragStartY = useSharedValue(0)
  const contentDragCanDismiss = useSharedValue(false)
  /** A finger on the list is moving the sheet. */
  const listDrivesSheet = useSharedValue(false)

  // Why the list is held at its top while a drag on it moves the sheet below
  // its top rest: nothing else may move under that finger. In the 2026-09-27
  // recording the list scrolled up under a finger that was dragging the sheet
  // down, took the title off the top, and the sheet came to rest at its
  // opening height with the list part way down. It is held at an expandable
  // sheet's opening height too, where the list does not scroll at all. Not
  // otherwise: a list still flinging while the handle moves the sheet, or
  // while the sheet springs back after a drag, keeps its fling.
  const scrollHandler = useAnimatedScrollHandler((event) => {
    const y = Math.max(event.contentOffset.y, 0)
    const held = listDrivesSheet.value || !listScrolls.value
    if (held && translateY.value > TOP_SCROLL_EPSILON && y > 0) {
      scrollTo(scrollRef, 0, 0, false)
      scrollOffsetY.value = 0
      return
    }
    scrollOffsetY.value = y
  })

  const gestures = useMemo(() => {
    const scroll = Gesture.Native()
    const listOwnsDrag = (): boolean => {
      'worklet'
      return listScrolls.value && scrollOffsetY.value > TOP_SCROLL_EPSILON
    }
    const settleExpandable = (velocityY: number) => {
      'worklet'
      // Its opening height shows the list from its first row: the list does
      // not scroll there, so a list left part way down stays that way.
      if (release(velocityY) === 'collapsed' && hasList) {
        scrollTo(scrollRef, 0, 0, false)
        scrollOffsetY.value = 0
      }
    }
    const closeOrSpringBack = (translationY: number, velocityY: number) => {
      'worklet'
      if (translationY > DISMISS_THRESHOLD || velocityY > 500) {
        const velocity = Math.max(velocityY, 800)
        const remaining = screenHeight - translationY
        const duration = Math.min(Math.max((remaining / velocity) * 1000, 120), 300)
        translateY.value = withTiming(screenHeight, { duration })
        progress.value = withTiming(0, { duration }, () => {
          runOnJS(close)()
        })
      } else {
        translateY.value = withSpring(0, DRAWER_SPRING)
      }
    }
    const followFinger = (translationY: number) => {
      'worklet'
      if (expandable) {
        drag(translationY)
      } else {
        translateY.value = translationY > 0 ? translationY : translationY * RUBBER_BAND_FACTOR
      }
    }
    const handle = Gesture.Pan()
      .activeOffsetY([-8, 8])
      .simultaneousWithExternalGesture(scroll)
      .onBegin(() => {
        begin()
      })
      .onUpdate((e) => {
        followFinger(e.translationY)
      })
      .onEnd((e) => {
        if (expandable) {
          settleExpandable(e.velocityY)
        } else {
          closeOrSpringBack(e.translationY, e.velocityY)
        }
      })
    const content = Gesture.Pan()
      .activeOffsetY([-8, 8])
      .simultaneousWithExternalGesture(scroll)
      .onBegin(() => {
        contentDragStartY.value = 0
        contentDragCanDismiss.value = !listOwnsDrag()
        begin()
      })
      .onUpdate((e) => {
        // Why: content can be taller than the drawer; a drag down on a
        // scrolled list scrolls it back to its top before it moves the sheet.
        if (listOwnsDrag()) {
          contentDragCanDismiss.value = false
          contentDragStartY.value = 0
          if (translateY.value !== 0) {
            translateY.value = withSpring(0, DRAWER_SPRING)
          }
          return
        }
        if (!contentDragCanDismiss.value) {
          contentDragCanDismiss.value = true
          contentDragStartY.value = e.translationY
          begin()
        }
        listDrivesSheet.value = true
        followFinger(e.translationY - contentDragStartY.value)
      })
      .onEnd((e) => {
        // The list had the whole drag: the sheet is at its top rest.
        if (!contentDragCanDismiss.value) {
          return
        }
        // Why no second look at the list here: while the sheet stands below
        // its rest the scroll handler holds the list at its top, and a sheet
        // the finger moved must come to rest, not stay where it was let go.
        if (expandable) {
          settleExpandable(e.velocityY)
        } else {
          closeOrSpringBack(e.translationY - contentDragStartY.value, e.velocityY)
        }
      })
      .onFinalize(() => {
        listDrivesSheet.value = false
      })
    return { scroll, handle, content }
  }, [expandable, hasList, screenHeight, begin, drag, release, close])

  return { ...gestures, scrollRef, scrollHandler, scrollOffsetY }
}
