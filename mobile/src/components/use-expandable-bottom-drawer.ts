import { useState } from 'react'
import {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue
} from 'react-native-reanimated'
import { spacing } from '../theme/mobile-theme'
import { dragExpandableSheet, expandableSheetHeights, settleExpandableSheet } from './bottom-drawer-expandable'

const SPRING_CONFIG = { damping: 28, stiffness: 400 }
const DISMISS_DURATION_MS = 220

/** The two-height state of an expandable drawer: how tall it stands, what a
 *  drag does to it, and where it rests when the finger lifts
 *  (bottom-drawer-expandable.ts holds the rules). Inert when `expandable` is
 *  false, so the drawer's other sheets are untouched. */
export function useExpandableBottomDrawer(args: {
  expandable: boolean
  screenHeight: number
  topInset: number
  translateY: SharedValue<number>
  progress: SharedValue<number>
  onClose: () => void
}) {
  const { expandable, screenHeight, translateY, progress, onClose } = args
  const heights = expandableSheetHeights({ screenHeight, topInset: args.topInset, topGap: spacing.lg })
  const sheetHeight = useSharedValue(heights.collapsed)
  const dragStartHeight = useSharedValue(heights.collapsed)
  // Why: while the sheet is at its opening height a drag on the content grows
  // it; letting the list scroll then would fight the finger for the same drag.
  const [expanded, setExpanded] = useState(false)
  const reset = () => {
    sheetHeight.value = heights.collapsed
    setExpanded(false)
  }
  const begin = () => {
    'worklet'
    dragStartHeight.value = sheetHeight.value
  }
  const drag = (translationY: number) => {
    'worklet'
    const next = dragExpandableSheet(dragStartHeight.value, translationY, heights)
    sheetHeight.value = next.height
    translateY.value = next.translateY
  }
  const release = (velocityY: number) => {
    'worklet'
    const settle = settleExpandableSheet({ height: sheetHeight.value, translateY: translateY.value, velocityY }, heights)
    if (settle === 'dismiss') {
      translateY.value = withTiming(screenHeight, { duration: DISMISS_DURATION_MS })
      progress.value = withTiming(0, { duration: DISMISS_DURATION_MS }, () => {
        runOnJS(onClose)()
      })
      return
    }
    sheetHeight.value = withSpring(settle === 'full' ? heights.full : heights.collapsed, SPRING_CONFIG)
    translateY.value = withSpring(0, SPRING_CONFIG)
    runOnJS(setExpanded)(settle === 'full')
  }
  const style = useAnimatedStyle(
    () => (expandable ? { height: sheetHeight.value } : {}),
    [sheetHeight, expandable]
  )
  return { expanded, reset, begin, drag, release, style }
}
