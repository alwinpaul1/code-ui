import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { Modal, Pressable, useWindowDimensions, View } from 'react-native'
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
import { useBackClaim } from '../navigation/use-back-claim'
import { useTheme } from '../theme/theme-context'
import { useReducedMotion } from '../ui/use-reduced-motion'
import { useResponsiveLayout } from '../layout/responsive-layout'
import { draggableDetailSheetStyles as styles } from './draggable-detail-sheet-styles'
import { DRAWER_SPRING } from './drawer-spring'
import { useDrawerCloseRequest } from './use-drawer-close-request'
import { useDrawerMountLifecycle } from './use-drawer-mount-lifecycle'
import { useKeyboardDismissedOnOpen } from './use-keyboard-dismissed-on-open'
import {
  resolveDraggableSheetHeights,
  resolveDraggableSheetSnap,
  type DraggableSheetSnap
} from './draggable-detail-sheet-snap'

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
  const { mounted, handleHidden } = useDrawerMountLifecycle(visible, onAfterClose)
  // A tool row tapped with the composer's keyboard up: without this the
  // sheet sat under the keyboard until its window took focus.
  useKeyboardDismissedOnOpen(visible)

  // Why: mount before commit so the entrance can animate on the very first
  // frame; unmount only once the exit animation reports finished, keeping a
  // closed sheet's gesture/Reanimated setup out of the render tree.
  if (!mounted) {
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

  // `showSheet` stands the sheet at its default rest and animates it in: an
  // open, and a close its parent refused (use-drawer-close-request.ts, which
  // also tells a sheet already off the screen from one still to animate out).
  const showSheet = () => {
    translateY.value = collapsedOffset
    scrollOffsetY.value = 0
    setSnap('default')
    progress.value = reduceMotion ? 1 : withTiming(1, { duration: SHOW_DURATION_MS })
  }
  const { requestClose, leftScreenRef } = useDrawerCloseRequest({ visible, onClose, restore: showSheet })

  useEffect(() => {
    if (visible) {
      showSheet()
    } else if (leftScreenRef.current) {
      onHidden()
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

  const dismiss = useCallback(() => {
    // Not `translateY.value = 0`: that moved a sheet standing at its default
    // rest up to its full-height position in one frame before it slid down.
    // The exit's own travel is the whole sheet height, so it clears the
    // screen from wherever the sheet stands.
    progress.value = withTiming(0, { duration: HIDE_DURATION_MS }, (finished) => {
      if (finished) {
        runOnJS(requestClose)()
      }
    })
  }, [progress, requestClose])

  // The seam every session sheet takes since upstream #22308: the hardware key natively, and a
  // claim on the shell's key inside the page. This sheet is the fork's own, so upstream's sweep
  // never reached it, and its old listener returned early on web — one press inside the page left
  // the session route with the sheet still open.
  useBackClaim(
    visible
      ? () => {
          dismiss()
          return true
        }
      : null
  )

  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollOffsetY.value = Math.max(event.contentOffset.y, 0)
  })

  // Why every gesture is memoised: the sheet re-renders whenever the call it
  // shows changes (a running tool streams its output), and a new Gesture.Pan()
  // per render makes gesture-handler reconfigure the handler tracking the
  // finger, mid-drag (the bottom drawer's gestures are built once for the same reason).
  const gestures = useMemo(() => {
    const settle = (nextTranslateY: number, velocityY: number) => {
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
            runOnJS(requestClose)()
          }
        })
        return
      }
      translateY.value = withSpring(outcome === 'full' ? 0 : collapsedOffset, DRAWER_SPRING)
      runOnJS(setSnap)(outcome)
    }
    const scroll = Gesture.Native()

    const handle = Gesture.Pan()
      .activeOffsetY([-8, 8])
      .simultaneousWithExternalGesture(scroll)
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
    const body = Gesture.Pan()
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

    const content = Gesture.Pan()
      .activeOffsetY([-8, 8])
      .simultaneousWithExternalGesture(scroll)
      .onBegin(() => {
        contentDragStartY.value = 0
        contentDragCanDismiss.value = scrollOffsetY.value <= TOP_SCROLL_EPSILON
      })
      .onUpdate((e) => {
        if (scrollOffsetY.value > TOP_SCROLL_EPSILON) {
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
    return { scroll, handle, body, content }
  }, [fullHeight, defaultHeight, collapsedOffset, requestClose])
  const scrollGesture = gestures.scroll
  const handlePanGesture = gestures.handle
  const bodyPanGesture = gestures.body
  const contentPanGesture = gestures.content

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
