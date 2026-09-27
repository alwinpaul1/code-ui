import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import {
  View,
  Pressable,
  useWindowDimensions,
  ScrollView,
  Keyboard,
  Modal,
  Platform
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation
} from 'react-native-reanimated'
import { spacing } from '../theme/mobile-theme'
import { useTheme } from '../theme/theme-context'
import { useReducedMotion } from '../ui/use-reduced-motion'
import { resolveBottomDrawerFillHeight } from './bottom-drawer-fill-height'
import { resolveBottomDrawerKeyboardInset } from './bottom-drawer-keyboard-inset'
import { BOTTOM_DRAWER_HIDE_DURATION_MS } from './bottom-drawer-constants'
import { bottomDrawerStyles as styles } from './bottom-drawer-styles'
import { useInsideBottomDrawerModalHost } from './bottom-drawer-modal-host'
import { useResponsiveLayout } from '../layout/responsive-layout'
import { useBackClaim } from '../navigation/use-back-claim'
import { useExpandableBottomDrawer } from './use-expandable-bottom-drawer'
import { useBottomDrawerDrag } from './use-bottom-drawer-drag'
import { useKeyboardDismissedOnOpen } from './use-keyboard-dismissed-on-open'

const SHOW_DURATION = 180
// Why: a sheet enters from just below its own bottom edge, not from a whole
// window below. Travelling the window height on an ease-in-out curve left a
// 280 dp sheet under the edge of a 956 dp window until 111 ms into its 180 ms
// open, so the + sheet looked slow to open (reported 2026-09-26). The margin
// keeps the Android elevation shadow out of sight at the start.
const ENTER_TRAVEL_MARGIN = 24
/** Decelerating: most of the travel happens in the first frames, the way an
 *  entering sheet should move, instead of Reanimated's default ease-in-out. */
function enterEasing(t: number): number {
  'worklet'
  return 1 - (1 - t) ** 3
}

export type MountedBottomDrawerProps = {
  visible: boolean
  onClose: () => void
  onHidden: () => void
  children: ReactNode
  dragContentToDismiss?: boolean
  contentScrollable?: boolean
  fillAvailable?: boolean
  // Why: outer sheets pinned under an inner fill picker stay laid out (size
  // preserved) but must not take touches, stack backdrops, or keyboard-lift.
  interactive?: boolean
  /** Opens part way and drags up to full screen (bottom-drawer-expandable.ts). */
  expandable?: boolean
  /** Drawn under the handle and above the content, outside its scroll, so a
   *  title and its close cross never scroll away. Dragging it moves the sheet,
   *  as the handle does. */
  header?: ReactNode
  zIndex?: number
  /** Sends the keyboard away as the sheet opens (BottomDrawer's prop). */
  dismissKeyboardOnOpen?: boolean
}

export function MountedBottomDrawer({
  visible,
  onClose,
  onHidden,
  children,
  dragContentToDismiss = true,
  contentScrollable = true,
  fillAvailable = false,
  interactive = true,
  expandable = false,
  header,
  zIndex = 1000,
  dismissKeyboardOnOpen = false
}: MountedBottomDrawerProps) {
  const translateY = useSharedValue(0)
  const progress = useSharedValue(0)
  const keyboardOffset = useSharedValue(0)
  // The sheet's own laid-out height; 0 until its first layout, when the only
  // distance known to be off screen is the whole window.
  const sheetLayoutHeight = useSharedValue(0)
  // The latest onClose, behind one stable function, so the gestures built
  // around it survive a parent that passes a new arrow on every render.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])
  const close = useCallback(() => onCloseRef.current(), [])
  useKeyboardDismissedOnOpen(visible && dismissKeyboardOnOpen)
  // Why: fill mode needs the keyboard inset in React layout (not only the
  // reanimated translate) so height shrinks as the sheet lifts and the top
  // edge stays under the status bar.
  const [keyboardInset, setKeyboardInset] = useState(0)
  const { height: screenHeight } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  // Why: read at style time only. `null` (not yet known) runs full motion: the
  // enter effect below is left exactly as recorded, so nothing here can add a
  // `withTiming(1)` the window hand-back test counts. In practice the answer
  // is already cached by the home screen's spinners before any sheet opens.
  const reduceMotion = useReducedMotion() === true
  // Why: on wide/tablet canvases a full-width sheet looks stretched; cap it and
  // center it horizontally. Vertical bottom-anchoring (and all the drag/keyboard
  // transforms below) is unchanged, so phone behavior stays identical.
  const { isWideLayout, modalMaxWidth } = useResponsiveLayout()
  const insideModalHost = useInsideBottomDrawerModalHost()
  const sheet = useExpandableBottomDrawer({ expandable, screenHeight, topInset: insets.top, translateY, progress, close })
  const drag = useBottomDrawerDrag({
    expandable,
    hasList: contentScrollable && dragContentToDismiss,
    screenHeight,
    translateY,
    progress,
    sheet,
    close
  })
  const fillHeight = fillAvailable
    ? resolveBottomDrawerFillHeight({
        screenHeight,
        topInset: insets.top,
        keyboardInset,
        topGap: spacing.lg
      })
    : undefined

  // Why: a sheet pinned under a fill picker holds progress at its target while the
  // picker owns the window, so nothing re-applies its transform when the picker
  // leaves. If the native view was rebuilt underneath, it keeps a stale transform
  // and never paints — a dimmed, dead screen the user can only escape by dismissing
  // the whole modal. A shared-value write alone cannot heal that (verified on
  // device: an unchanged or nudged style lands on the stale native binding), so the
  // remount is what repaints; the writes below keep the shared values authoritative
  // for the fresh view, which matters because the drawer swap (166ms) hands back
  // before the 180ms enter animation has finished.
  const [windowEpoch, setWindowEpoch] = useState(0)
  const wasInteractiveRef = useRef(interactive)
  useEffect(() => {
    const tookWindowBack = visible && interactive && !wasInteractiveRef.current
    wasInteractiveRef.current = interactive
    if (!tookWindowBack) {
      return
    }
    translateY.value = sheet.restingOffset
    progress.value = withTiming(1, { duration: SHOW_DURATION, easing: enterEasing })
    setWindowEpoch((epoch) => epoch + 1)
  }, [interactive, visible])

  useEffect(() => {
    if (visible) {
      drag.resetList()
      // Stands the sheet at its rest: 0, or an expandable sheet's opening offset.
      sheet.reset()
      progress.value = withTiming(1, { duration: SHOW_DURATION, easing: enterEasing })
    } else {
      Keyboard.dismiss()
      setKeyboardInset(0)
      progress.value = withTiming(0, { duration: BOTTOM_DRAWER_HIDE_DURATION_MS }, (finished) => {
        if (finished) {
          runOnJS(onHidden)()
        }
      })
    }
  }, [onHidden, visible])

  // Why: KeyboardAvoidingView and useAnimatedKeyboard are both unreliable
  // inside Modal (iOS ignores KAV; Android needs adjustNothing for
  // useAnimatedKeyboard). Keyboard event listeners work on both platforms
  // and give us the exact height to shift the drawer by.
  useEffect(() => {
    // Pinned-under sheets stay visible for size but must not ride the keyboard —
    // only the top interactive sheet owns inset/lift.
    if (!visible || !interactive) {
      keyboardOffset.value = 0
      setKeyboardInset(0)
      return
    }

    function applyKeyboardHeight(keyboardHeight: number, duration = 0): void {
      const inset = resolveBottomDrawerKeyboardInset({
        keyboardHeight,
        bottomInset: insets.bottom,
        fillAvailable,
        platform: Platform.OS
      })
      setKeyboardInset(inset)
      if (duration > 0) {
        keyboardOffset.value = withTiming(inset, { duration })
      } else {
        keyboardOffset.value = inset
      }
    }

    // Why: fill sheets dock to the true keyboard top; autoFocus can raise the
    // keyboard before listeners attach. Seed only in fill mode so content-sized
    // outer sheets do not inherit a stale metrics height after an inner dismiss.
    if (fillAvailable) {
      const existing = Keyboard.metrics()
      if (existing != null && existing.height > 0) {
        applyKeyboardHeight(existing.height)
      }
    }

    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'

    const onShow = Keyboard.addListener(showEvent, (e) => {
      applyKeyboardHeight(e.endCoordinates.height, e.duration || 250)
    })
    const onHide = Keyboard.addListener(hideEvent, (e) => {
      setKeyboardInset(0)
      keyboardOffset.value = withTiming(0, { duration: e.duration || 250 })
    })

    return () => {
      onShow.remove()
      onHide.remove()
      keyboardOffset.value = 0
      setKeyboardInset(0)
    }
  }, [visible, interactive, insets.bottom, fillAvailable])

  const dismiss = useCallback(() => {
    Keyboard.dismiss()
    progress.value = withTiming(0, { duration: BOTTOM_DRAWER_HIDE_DURATION_MS }, (finished) => {
      if (finished) {
        runOnJS(onClose)()
      }
    })
  }, [onClose, progress])

  // One seam, both platforms: natively this is the hardware key, and inside the shell's page it is
  // a claim the shell hands one press over on. Every session sheet renders through this component,
  // so this one claim is what makes Android Back close the sheet rather than leave the screen.
  // Only the top interactive drawer claims; a sheet pinned under a fill picker does not own the key.
  useBackClaim(
    visible && interactive
      ? () => {
          dismiss()
          return true
        }
      : null
  )

  const drawerStyle = useAnimatedStyle(() => {
    // Why: fill mode already shrinks height by the keyboard inset and lifts via
    // marginBottom (layout). Also subtracting keyboardOffset here would double-
    // count and park the dock under the keys (input hidden).
    const keyboardShift = fillAvailable ? 0 : keyboardOffset.value
    // Why: under reduced motion the sheet has no enter travel; `progress`
    // drives its opacity instead, so it fades in place. The drag offset and
    // the keyboard lift still apply: those follow the finger and the keys,
    // not a transition. Only this mapping changes; the effects, durations
    // and gestures are untouched.
    // Once laid out, the sheet travels its own height (plus a margin), so it
    // is on screen from the first frames of its open; before that, a window.
    // The keyboard's lift counts too: a sheet closed while it is up sits that
    // much higher, and fell short of the edge by it (review of a81dfa20).
    // A closed sheet keeps the window as its travel: a fill sheet grows back
    // by the keyboard inset as it closes, a frame before its new height is
    // measured, and would show that much (review of a81dfa20).
    // An expandable sheet is laid out at full height and stands part way
    // below it, so only what is above the edge travels.
    const measured = sheetLayoutHeight.value
    const belowEdge = expandable ? Math.min(Math.max(translateY.value, 0), measured) : 0
    const travel =
      measured > 0 && progress.value > 0
        ? Math.min(screenHeight, measured - belowEdge + keyboardOffset.value + ENTER_TRAVEL_MARGIN)
        : screenHeight
    const enterTravel = reduceMotion
      ? 0
      : interpolate(progress.value, [0, 1], [travel, 0], Extrapolation.CLAMP)
    // Why `opacity` is ALWAYS returned, even at a constant 1: Reanimated writes
    // only the keys a worklet returns and never clears one that disappears
    // (useAnimatedStyle's styleUpdater loops `for (const key in newValues)` with
    // no diff against the last frame). Returning it conditionally strands the
    // view at whatever opacity it last wrote — and the stale-cache path does
    // exactly that, rendering the first frame near 0 and then dropping the key,
    // leaving a fully interactive drawer invisible under a live backdrop.
    // An expandable sheet's box is exactly full height: above its top rest it
    // would lift its bottom off the screen, and nothing may take it there.
    const offset = expandable ? Math.max(translateY.value, 0) : translateY.value
    const transform = [{ translateY: enterTravel + offset - keyboardShift }]
    return { opacity: reduceMotion ? progress.value : 1, transform }
    // The dependency array names every shared value the updater reads: the web bundle is built
    // without Reanimated's Babel plugin, so `__closure` is never written and this list is what the
    // mapper listens to (reanimated-web-mapper-deps.test.ts).
  }, [progress, translateY, keyboardOffset, sheetLayoutHeight, screenHeight, fillAvailable, reduceMotion, expandable])

  const openingOffset = sheet.openingOffset
  const backdropStyle = useAnimatedStyle(() => {
    // Fades only as the sheet is dragged below its opening height; an
    // expandable sheet stands `openingOffset` down at rest.
    const dragFade = interpolate(translateY.value - openingOffset, [0, 300], [1, 0], Extrapolation.CLAMP)
    return { opacity: progress.value * dragFade }
  }, [progress, translateY, openingOffset])

  // Why: an expandable sheet at its opening height stands with its bottom
  // (and the inset padding that keeps rows off the gesture bar) below the
  // screen, so its rows ran to the screen's edge. This strip of the sheet's
  // own colour lies over them at the edge; it rides up with the sheet only
  // below its opening height, as the sheet leaves. Moved, never resized.
  const bottomStripStyle = useAnimatedStyle(() => {
    return { transform: [{ translateY: -Math.min(Math.max(translateY.value, 0), openingOffset) }] }
  }, [translateY, openingOffset])

  // Why: the sheet renders through a full-screen native window (its own Modal
  // below, or the shared BottomDrawerModalHost) so it always covers the viewport
  // — even when mounted deep inside a ScrollView, where a plain absolute overlay
  // anchors to the scrolled content and clips the sheet. Show/hide is driven by
  // `progress` (animationType "none") so the reanimated exit animation runs before
  // the parent unmounts us.
  const handleBar = (
    <Animated.View
      style={styles.handleHitArea}
      accessibilityRole="button"
      accessibilityLabel="Dismiss drawer"
    >
      <View style={[styles.handle, { backgroundColor: colors.textMuted }]} />
    </Animated.View>
  )
  const handle = (
    <GestureDetector gesture={drag.handle}>
      {header ? (
        <Animated.View collapsable={false}>
          {handleBar}
          {header}
        </Animated.View>
      ) : (
        handleBar
      )}
    </GestureDetector>
  )

  const body = !contentScrollable ? (
    <>
      {handle}
      <View style={[styles.staticContent, fillAvailable && styles.staticContentFill]}>
        {children}
      </View>
    </>
  ) : dragContentToDismiss ? (
    <>
      {handle}
      <GestureDetector gesture={drag.content}>
        <Animated.View collapsable={false} style={expandable ? styles.staticContentFill : undefined}>
          <GestureDetector gesture={drag.scroll}>
            <Animated.ScrollView
              ref={drag.scrollRef}
              style={expandable ? styles.staticContentFill : undefined}
              scrollEnabled={!expandable || sheet.expanded}
              bounces={false}
              keyboardShouldPersistTaps="handled"
              onScroll={drag.scrollHandler}
              scrollEventThrottle={16}
              showsVerticalScrollIndicator={false}
            >
              {children}
            </Animated.ScrollView>
          </GestureDetector>
        </Animated.View>
      </GestureDetector>
    </>
  ) : (
    <>
      {handle}
      <ScrollView
        bounces={false}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </>
  )

  const overlay = (
    <Animated.View
      pointerEvents={visible && interactive ? 'auto' : 'none'}
      style={[styles.overlay, { zIndex, elevation: zIndex }]}
      accessibilityViewIsModal={interactive}
      aria-modal={interactive}
    >
      <GestureHandlerRootView style={styles.root}>
        <Animated.View
          // Why: pinned-under outer sheets keep progress=1 so size stays; hide
          // their backdrop so only the top interactive drawer dims the canvas.
          style={[
            styles.backdrop,
            { backgroundColor: colors.bgOverlay },
            interactive ? backdropStyle : { opacity: 0 }
          ]}
        >
          {interactive ? <Pressable style={styles.backdropPressable} onPress={dismiss} /> : null}
        </Animated.View>

        <View style={[styles.anchor, isWideLayout && styles.anchorWide]} pointerEvents="box-none">
          <Animated.View
            // Why: remount per window hand-back — see the windowEpoch effect.
            key={windowEpoch}
            // The sheet names itself so a check can find it without reading its styling.
            testID="bottom-drawer-sheet"
            onLayout={(event) => {
              sheetLayoutHeight.value = event.nativeEvent.layout.height
            }}
            style={[
              styles.drawer,
              fillAvailable || expandable ? styles.drawerFill : null,
              {
                backgroundColor: colors.bgPanel,
                borderTopLeftRadius: 24,
                borderTopRightRadius: 24,
                width: '100%',
                maxWidth: isWideLayout ? modalMaxWidth : undefined,
                maxHeight: screenHeight - insets.top - spacing.lg,
                // Why: fill sheets shrink height AND lift with marginBottom so the
                // bottom edge sits on the keyboard top (height alone still leaves
                // the dock in the keyboard’s footprint). Non-fill sheets keep
                // the legacy translateY keyboard shift instead. An expandable
                // sheet is laid out once at full height and only moved, so a
                // drag costs no layout pass (2026-09-27).
                height: sheet.fullHeight ?? fillHeight,
                marginBottom: fillAvailable ? keyboardInset : 0,
                paddingBottom:
                  fillAvailable && keyboardInset > 0 ? spacing.sm : insets.bottom + spacing.lg
              },
              drawerStyle
            ]}
          >
            {body}
            {expandable ? (
              <Animated.View
                testID="bottom-drawer-bottom-strip"
                pointerEvents="none"
                style={[
                  styles.bottomStrip,
                  { height: insets.bottom + spacing.lg, backgroundColor: colors.bgPanel },
                  bottomStripStyle
                ]}
              />
            ) : null}
            <View style={[styles.bottomExtension, { backgroundColor: colors.bgPanel }]} />
          </Animated.View>
        </View>
      </GestureHandlerRootView>
    </Animated.View>
  )

  // Why: inside a BottomDrawerModalHost the host owns the single native Modal;
  // rendering our own would stack modals and reintroduce the iOS present/dismiss
  // race the host exists to avoid. The host handles the Android back button.
  if (insideModalHost) {
    return overlay
  }

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={dismiss}>
      {overlay}
    </Modal>
  )
}
