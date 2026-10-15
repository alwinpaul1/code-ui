package expo.modules.orcaselectioncopy

import kotlin.math.abs

/**
 * When a scroll, not a hold, owns the finger on a document (SelectionCopyRootView).
 *
 * The chat list scrolls under gesture-handler (Gesture.Native(), react-native-gesture-handler
 * 2.32.0). Once its handler activates, gesture-handler's root stops passing the touch to the
 * Android views below (RNGestureHandlerRootHelper.dispatchTouchEvent returns true) and sends them
 * no ACTION_CANCEL; it drives the ScrollView itself. So the MOVE that starts the scroll never
 * reaches the document's root, and a Text's long press armed at the finger down goes off at the
 * timeout mid-scroll: the haptic and a word selected with no menu (the user, 2026-10-15:
 * "Sometimes when scrolling the vibration triggers and text is somehow getting selected"). The
 * root therefore also asks where the document stands in its window while the finger is down.
 */

/** A pixel either way is rounding in a layout pass, not the list moving. */
private const val ROUNDING_PX = 1

/**
 * Whether a document that stood at ([downX], [downY]) in its window when the finger went down has
 * been moved by the list under that finger. Either direction: the chat list is inverted.
 */
internal fun scrolledUnderFinger(downX: Int, downY: Int, x: Int, y: Int): Boolean =
  abs(x - downX) > ROUNDING_PX || abs(y - downY) > ROUNDING_PX

/**
 * Whether a MOVE the root saw cancels the pending hold: the finger is past the touch slop
 * ([pastSlop]) no later than the long-press timeout. At the timeout itself the hold has not gone
 * off yet (its callback runs after this frame's input), so a drag then is still a drag.
 */
internal fun dragCancelsHold(elapsedMs: Long, longPressTimeoutMs: Long, pastSlop: Boolean): Boolean =
  pastSlop && elapsedMs <= longPressTimeoutMs
