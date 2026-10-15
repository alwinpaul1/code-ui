package expo.modules.orcaselectioncopy

import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.max

/**
 * When a scroll, not a hold, owns the finger on a document (SelectionCopyRootView).
 *
 * The chat list scrolls under gesture-handler (Gesture.Native(), react-native-gesture-handler
 * 2.32.0). Once its handler activates, gesture-handler's root stops passing the touch to the
 * Android views below (RNGestureHandlerRootHelper.dispatchTouchEvent returns true) and drives the
 * ScrollView itself. The views below hear nothing more of that gesture: no MOVE, no lift, and no
 * ACTION_CANCEL until the next finger down, when ViewGroup.cancelAndClearTouchTargets clears the
 * old touch targets. So the MOVE that starts the scroll never reaches the document's root, and a
 * Text's long press armed at the finger down goes off at the timeout mid-scroll: the haptic and a
 * word selected with no menu (the user, 2026-10-15: "Sometimes when scrolling the vibration
 * triggers and text is somehow getting selected"). The root therefore also asks where the
 * document stands in its window while the finger is down, until the hold has gone off.
 */

/**
 * How far a document may move in its window and still count as standing still: about one dp in
 * pixels, never under one pixel. FlashList's anchor and its content can disagree by a pixel or
 * two while a turn streams, and that must not cancel a hold.
 */
internal fun roundingTolerancePx(density: Float): Int = max(1, ceil(density.toDouble()).toInt())

/**
 * Whether a document that stood at ([downX], [downY]) in its window when the finger went down has
 * been moved by more than [tolerancePx] under that finger. Either direction: the chat list is
 * inverted.
 */
internal fun scrolledUnderFinger(downX: Int, downY: Int, x: Int, y: Int, tolerancePx: Int): Boolean =
  abs(x - downX) > tolerancePx || abs(y - downY) > tolerancePx

/**
 * Whether this gesture's hold has already gone off: the long-press timeout has passed since the
 * finger went down, or a Text below holds words this gesture lit ([litThisGesture], which also
 * covers a deep press that goes off at once). After that, a scroll is no longer the list taking a
 * hold away. In a plain ScrollView it is usually the hold's own doing: the selected Text asks for
 * focus and ReactScrollView.requestChildFocus scrolls it into view.
 */
internal fun holdHasFired(elapsedMs: Long, longPressTimeoutMs: Long, litThisGesture: Boolean): Boolean =
  litThisGesture || elapsedMs >= longPressTimeoutMs

/**
 * Whether a MOVE the root saw cancels the pending hold: the finger is past the touch slop
 * ([pastSlop]) no later than the long-press timeout. At the timeout itself the hold's callback
 * may not have run yet (it is a message queued behind this frame's input, posted from the tap
 * check), so a drag then is still taken for a drag; if the hold did go off first, cancelling it is
 * harmless.
 */
internal fun dragCancelsHold(elapsedMs: Long, longPressTimeoutMs: Long, pastSlop: Boolean): Boolean =
  pastSlop && elapsedMs <= longPressTimeoutMs
