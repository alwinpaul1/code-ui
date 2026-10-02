import { useEffect, useMemo, useState } from 'react'
import { runOnJS, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated'
import { spacing } from '../theme/mobile-theme'
import {
  dragExpandableSheet,
  expandableSheetHeights,
  expandableSheetOpeningOffset,
  settleExpandableSheet,
  type ExpandableSheetSettle
} from './bottom-drawer-expandable'
import { DRAWER_SPRING } from './drawer-spring'

const DISMISS_DURATION_MS = 220

/** The two rests of an expandable drawer, what a drag does between them, and
 *  where it comes to rest when the finger lifts (bottom-drawer-expandable.ts
 *  holds the rules). The sheet is laid out once at `fullHeight` and moved by
 *  `translateY`: 0 at full height, `openingOffset` at its opening height.
 *  Inert when `expandable` is false: the rest is 0 and the list always
 *  scrolls, so the drawer's other sheets are untouched. */
export function useExpandableBottomDrawer(args: {
  expandable: boolean
  screenHeight: number
  topInset: number
  translateY: SharedValue<number>
  progress: SharedValue<number>
  /** Stable for the drawer's life: the gestures are built once around it. */
  close: () => void
}) {
  const { expandable, screenHeight, translateY, progress, close } = args
  const { collapsed, full } = expandableSheetHeights({ screenHeight, topInset: args.topInset, topGap: spacing.lg })
  const openingOffset = expandable ? expandableSheetOpeningOffset({ collapsed, full }) : 0
  const dragStartOffset = useSharedValue(0)
  // Why a shared value beside `expanded`: the gestures read it on the UI thread
  // in the frame the finger lifts, where the state reaches the list's
  // scrollEnabled only after a render.
  const listScrolls = useSharedValue(!expandable)
  // Why: at its opening height a drag on the content moves the sheet; letting
  // the list scroll there would fight the finger for the same drag.
  const [expanded, setExpanded] = useState(false)
  // Built once per window size, so a re-render mid-drag (the running clock,
  // a streamed message) hands gesture-handler the same callbacks.
  const worklets = useMemo(() => {
    const heights = { collapsed, full }
    const begin = () => {
      'worklet'
      dragStartOffset.value = translateY.value
    }
    const drag = (translationY: number) => {
      'worklet'
      translateY.value = dragExpandableSheet(dragStartOffset.value, translationY)
    }
    const release = (velocityY: number): ExpandableSheetSettle => {
      'worklet'
      const settle = settleExpandableSheet({ offset: translateY.value, velocityY }, heights)
      if (settle === 'dismiss') {
        translateY.value = withTiming(screenHeight, { duration: DISMISS_DURATION_MS })
        progress.value = withTiming(0, { duration: DISMISS_DURATION_MS }, (finished) => {
          if (finished) {
            runOnJS(close)()
          }
        })
        return settle
      }
      const toFull = settle === 'full'
      listScrolls.value = toFull
      translateY.value = withSpring(toFull ? 0 : expandableSheetOpeningOffset(heights), DRAWER_SPRING)
      runOnJS(setExpanded)(toFull)
      return settle
    }
    return { begin, drag, release }
  }, [collapsed, full, screenHeight, close])
  const restingOffset = expanded ? 0 : openingOffset
  // Why: turning the phone moves both rests, and nothing else would move the
  // sheet onto the new one. Left at its portrait offset in landscape, it
  // showed 71 dp of itself, and a 10 dp nudge on the handle closed it.
  useEffect(() => {
    if (expandable) {
      translateY.value = restingOffset
    }
  }, [openingOffset])
  const reset = () => {
    translateY.value = openingOffset
    listScrolls.value = !expandable
    setExpanded(false)
  }
  return {
    ...worklets,
    expanded,
    listScrolls,
    openingOffset,
    /** Where the sheet stands at rest right now. */
    restingOffset,
    fullHeight: expandable ? full : undefined,
    reset
  }
}
