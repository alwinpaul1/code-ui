import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { BackHandler, Modal, Platform, Pressable, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming
} from 'react-native-reanimated'
import { X } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'
import { useReducedMotion } from '../ui/use-reduced-motion'
import { useResponsiveLayout } from '../layout/responsive-layout'
import { draggableDetailSheetStyles as styles } from './draggable-detail-sheet-styles'
import {
  resolveDraggableSheetHeights,
  resolveDraggableSheetSnap,
  type DraggableSheetSnap
} from './draggable-detail-sheet-snap'

const SPRING_CONFIG = { damping: 28, stiffness: 400 }
// Why: dragging past a rest (up past full, or the far side of a settle point)
// resists rather than following the finger 1:1 — the same rubber-band touch
// BottomDrawer uses, so both sheets feel like one family.
const RUBBER_BAND_FACTOR = 0.25
const SHOW_DURATION_MS = 180
const HIDE_DURATION_MS = 150
const TOP_SCROLL_EPSILON = 1
const TOP_GAP = 24
const MIN_DISMISS_DURATION_MS = 120
const MAX_DISMISS_DURATION_MS = 300
const DISMISS_VELOCITY_FLOOR = 800

export type DraggableDetailSheetProps = {
  visible: boolean
  onClose: () => void
  onAfterClose?: () => void
  /** Rendered above the scrollable body, outside it, so a title/status never
   *  scrolls away. The close (X) button is the sheet's own chrome and sits
   *  above this. */
  header: ReactNode
  children: ReactNode
}

/**
 * A bottom sheet with two rests instead of one: opens at "about half the
 * screen", drags up to fill it, and drags back down (or the X) to close —
 * the Claude app's tool-detail sheet (2026-09-24 evidence). `BottomDrawer`
 * only ever has one rest plus dismiss, so this is its own primitive rather
 * than a mode grafted onto that one; the two share no file. Content is a
 * plain View at the default height (nothing to scroll yet) and becomes a
 * ScrollView once dragged to full, matching "opens in a default view, and
 * when pulled up to the screen can be scrollable" from the user's report.
 */
export function DraggableDetailSheet({
  visible,
  onClose,
  onAfterClose,
  header,
  children
}: DraggableDetailSheetProps) {
  const [mounted, setMounted] = useState(visible)
  const onAfterCloseRef = useRef(onAfterClose)
  const hiddenHandledRef = useRef(false)

  useEffect(() => {
    onAfterCloseRef.current = onAfterClose
  }, [onAfterClose])

  useEffect(() => {
    if (visible) {
      hiddenHandledRef.current = false
    }
  }, [visible])

  const handleHidden = useCallback(() => {
    if (hiddenHandledRef.current) {
      return
    }
    hiddenHandledRef.current = true
    setMounted(false)
    onAfterCloseRef.current?.()
  }, [])

  // Why: mount before commit so the entrance can animate on the very first
  // frame; unmount only once the exit animation reports finished, keeping a
  // closed sheet's gesture/Reanimated setup out of the render tree.
  const resolvedMounted = visible || mounted
  if (resolvedMounted !== mounted) {
    setMounted(resolvedMounted)
  }
  if (!resolvedMounted) {
    return null
  }

  return (
    <MountedDraggableDetailSheet visible={visible} onClose={onClose} onHidden={handleHidden} header={header}>
      {children}
    </MountedDraggableDetailSheet>
  )
}

function MountedDraggableDetailSheet({
  visible,
  onClose,
  onHidden,
  header,
  children
}: {
  visible: boolean
  onClose: () => void
  onHidden: () => void
  header: ReactNode
  children: ReactNode
}) {
  const translateY = useSharedValue(0)
  const dragStartOffset = useSharedValue(0)
  const progress = useSharedValue(0)
  const scrollOffsetY = useSharedValue(0)
  const contentDragStartY = useSharedValue(0)
  const contentDragCanDismiss = useSharedValue(false)
  const [snap, setSnap] = useState<Exclude<DraggableSheetSnap, 'closed'>>('default')

  const { height: screenHeight } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const reduceMotion = useReducedMotion() === true
  const { isWideLayout, modalMaxWidth } = useResponsiveLayout()

  const { fullHeight, defaultHeight } = resolveDraggableSheetHeights({
    screenHeight,
    topInset: insets.top,
    topGap: TOP_GAP
  })
  const collapsedOffset = Math.max(0, fullHeight - defaultHeight)

  useEffect(() => {
    if (visible) {
      translateY.value = collapsedOffset
      scrollOffsetY.value = 0
      setSnap('default')
      progress.value = reduceMotion ? 1 : withTiming(1, { duration: SHOW_DURATION_MS })
    } else {
      progress.value = withTiming(0, { duration: HIDE_DURATION_MS }, (finished) => {
        if (finished) {
          runOnJS(onHidden)()
        }
      })
    }
    // `collapsedOffset`/`reduceMotion` deliberately excluded: a rotation or a
    // live a11y-setting change while the sheet is already open must not reset
    // its position back to the open/opening transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  useEffect(() => {
    if (!visible || Platform.OS === 'web') {
      return
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      dismiss()
      return true
    })
    return () => sub.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  const dismiss = useCallback(() => {
    translateY.value = 0
    progress.value = withTiming(0, { duration: HIDE_DURATION_MS }, (finished) => {
      if (finished) {
        runOnJS(onClose)()
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose])

  function settle(nextTranslateY: number, velocityY: number) {
    'worklet'
    const outcome = resolveDraggableSheetSnap({
      translateY: nextTranslateY,
      velocityY,
      fullHeight,
      defaultHeight
    })
    if (outcome === 'closed') {
      const velocity = Math.max(velocityY, DISMISS_VELOCITY_FLOOR)
      const remaining = fullHeight - nextTranslateY
      const duration = Math.min(
        Math.max((remaining / velocity) * 1000, MIN_DISMISS_DURATION_MS),
        MAX_DISMISS_DURATION_MS
      )
      translateY.value = withTiming(fullHeight, { duration })
      progress.value = withTiming(0, { duration }, (finished) => {
        if (finished) {
          runOnJS(onClose)()
        }
      })
      return
    }
    translateY.value = withSpring(outcome === 'full' ? 0 : collapsedOffset, SPRING_CONFIG)
    runOnJS(setSnap)(outcome)
  }

  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollOffsetY.value = Math.max(event.contentOffset.y, 0)
  })
  const scrollGesture = Gesture.Native()

  const handlePanGesture = Gesture.Pan()
    .activeOffsetY([-8, 8])
    .simultaneousWithExternalGesture(scrollGesture)
    .onBegin(() => {
      dragStartOffset.value = translateY.value
    })
    .onUpdate((e) => {
      const next = dragStartOffset.value + e.translationY
      translateY.value = next < 0 ? next * RUBBER_BAND_FACTOR : next
    })
    .onEnd((e) => {
      settle(translateY.value, e.velocityY)
    })

  // Why: at the default height nothing scrolls yet (per the evidence, the
  // sheet opens static and only scrolls once pulled to full), so dragging
  // anywhere on the body should behave exactly like dragging the handle.
  const bodyPanGesture = Gesture.Pan()
    .activeOffsetY([-8, 8])
    .onBegin(() => {
      dragStartOffset.value = translateY.value
    })
    .onUpdate((e) => {
      const next = dragStartOffset.value + e.translationY
      translateY.value = next < 0 ? next * RUBBER_BAND_FACTOR : next
    })
    .onEnd((e) => {
      settle(translateY.value, e.velocityY)
    })

  const contentPanGesture = Gesture.Pan()
    .activeOffsetY([-8, 8])
    .simultaneousWithExternalGesture(scrollGesture)
    .onBegin(() => {
      contentDragStartY.value = 0
      contentDragCanDismiss.value = scrollOffsetY.value <= TOP_SCROLL_EPSILON
    })
    .onUpdate((e) => {
      if (scrollOffsetY.value > TOP_SCROLL_EPSILON) {
        contentDragCanDismiss.value = false
        contentDragStartY.value = 0
        if (translateY.value !== 0) {
          translateY.value = withSpring(0, SPRING_CONFIG)
        }
        return
      }
      if (!contentDragCanDismiss.value) {
        contentDragCanDismiss.value = true
        contentDragStartY.value = e.translationY
      }
      const dragged = e.translationY - contentDragStartY.value
      translateY.value = dragged < 0 ? dragged * RUBBER_BAND_FACTOR : dragged
    })
    .onEnd((e) => {
      if (!contentDragCanDismiss.value || scrollOffsetY.value > TOP_SCROLL_EPSILON) {
        return
      }
      const dragged = e.translationY - contentDragStartY.value
      settle(Math.max(0, dragged), e.velocityY)
    })

  const sheetStyle = useAnimatedStyle(() => {
    const enterTravel = reduceMotion
      ? 0
      : interpolate(progress.value, [0, 1], [fullHeight, 0], Extrapolation.CLAMP)
    return {
      opacity: reduceMotion ? progress.value : 1,
      transform: [{ translateY: enterTravel + translateY.value }]
    }
  }, [progress, translateY, fullHeight, reduceMotion])

  const backdropStyle = useAnimatedStyle(() => {
    const dragFade = interpolate(translateY.value, [0, fullHeight], [1, 0], Extrapolation.CLAMP)
    return { opacity: progress.value * dragFade }
  }, [progress, translateY, fullHeight])

  const handle = (
    <GestureDetector gesture={handlePanGesture}>
      <Animated.View
        style={styles.handleHitArea}
        accessibilityRole="button"
        accessibilityLabel="Drag to resize"
      >
        <View style={[styles.handle, { backgroundColor: colors.textMuted }]} />
      </Animated.View>
    </GestureDetector>
  )

  const closeButton = (
    <Pressable
      style={styles.closeButton}
      onPress={dismiss}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Close"
      testID="draggable-detail-sheet-close"
    >
      <X size={20} color={colors.textMuted} strokeWidth={2} />
    </Pressable>
  )

  const body =
    snap === 'default' ? (
      <GestureDetector gesture={bodyPanGesture}>
        <Animated.View collapsable={false} style={styles.staticContent}>
          {children}
        </Animated.View>
      </GestureDetector>
    ) : (
      <GestureDetector gesture={contentPanGesture}>
        <Animated.View collapsable={false} style={{ flex: 1 }}>
          <GestureDetector gesture={scrollGesture}>
            <Animated.ScrollView
              onScroll={scrollHandler}
              scrollEventThrottle={16}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator
              testID="draggable-detail-sheet-scroll"
            >
              {children}
            </Animated.ScrollView>
          </GestureDetector>
        </Animated.View>
      </GestureDetector>
    )

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={dismiss}>
      <Animated.View pointerEvents={visible ? 'auto' : 'none'} style={styles.overlay}>
        <GestureHandlerRootView style={styles.root}>
          <Animated.View style={[styles.backdrop, { backgroundColor: colors.bgOverlay }, backdropStyle]}>
            <Pressable style={styles.backdropPressable} onPress={dismiss} />
          </Animated.View>
          <View style={[styles.anchor, isWideLayout && styles.anchorWide]} pointerEvents="box-none">
            <Animated.View
              testID="draggable-detail-sheet"
              style={[
                styles.sheet,
                {
                  backgroundColor: colors.bgPanel,
                  height: fullHeight,
                  width: '100%',
                  maxWidth: isWideLayout ? modalMaxWidth : undefined,
                  paddingBottom: insets.bottom
                },
                sheetStyle
              ]}
            >
              {handle}
              {closeButton}
              <View style={styles.header}>{header}</View>
              {body}
              <View style={[styles.bottomExtension, { backgroundColor: colors.bgPanel }]} />
            </Animated.View>
          </View>
        </GestureHandlerRootView>
      </Animated.View>
    </Modal>
  )
}
