package expo.modules.orcaselectioncopy

import android.widget.TextView
import kotlin.math.max
import kotlin.math.min

/**
 * A selection the chat can do nothing with: words lit in a Text with no menu standing for them.
 *
 * Android selects the word under a long press at once and opens its menu only when the finger
 * lifts (Editor.selectCurrentWordAndStartDrag, then startSelectionActionModeAsync at ACTION_UP).
 * The chat's scroll view is a gesture-handler Gesture.Native(), which asks the ScrollView to
 * intercept directly (NativeViewGestureHandler.tryIntercept, react-native-gesture-handler 2.32.0)
 * whatever the Text asked with requestDisallowInterceptTouchEvent. So a finger that rested past the
 * long-press timeout and then dragged scrolls the list, the Text gets ACTION_CANCEL instead of a
 * lift, and the word stays lit with no menu: seen on the user's phone on 2026-10-15 (0.9.150) as
 * the highlight landing on "pictures" and on a table cell's "used" as the chat scrolled, with no
 * "Selection opened" line in the log for either. The document's root clears such a selection
 * (SelectionCopyRootView.sweepStrays).
 */

/** A selection's range, low end first; null for none. */
internal data class SelectedRange(val start: Int, val end: Int)

/** The range a Text's selection covers, from its two ends in either order; null when it covers none. */
internal fun selectedRangeOf(selectionStart: Int, selectionEnd: Int, length: Int): SelectedRange? {
  val low = min(selectionStart, selectionEnd)
  val high = max(selectionStart, selectionEnd)
  return if (low < 0 || high <= low || high > length) null else SelectedRange(low, high)
}

internal fun selectedRangeIn(text: TextView): SelectedRange? =
  selectedRangeOf(text.selectionStart, text.selectionEnd, text.text.length)

/**
 * Whether a Text's selection after a gesture is a stray: words are selected ([after]), no menu
 * stands for them ([hasMenu] false), and the gesture made them (they differ from [before], what
 * the Text held when the finger went down). A selection with its menu is never one, and nor is
 * one the Text already held before this gesture: this touch did not make it.
 */
internal fun isStraySelection(before: SelectedRange?, after: SelectedRange?, hasMenu: Boolean): Boolean =
  after != null && !hasMenu && after != before

/** Whether a finger that went down at ([downX], [downY]) is now further than [slop] from there. */
internal fun movedPastSlop(downX: Float, downY: Float, x: Float, y: Float, slop: Float): Boolean {
  val dx = x - downX
  val dy = y - downY
  return dx * dx + dy * dy > slop * slop
}

/**
 * The chat's selections that have their menu (or had it and are still selected), each with the
 * callback watching it ([SelectionLifeCallback]). One at a time, as Android means it: one opening
 * drops the others, which a selection in a second Text, or in a second document, never did by
 * itself. An entry leaves when its callback stops watching, and at the latest when the next
 * selection opens. Main thread only.
 */
internal object LiveSelections {
  private val live = HashMap<TextView, SelectionLifeCallback>()

  fun watching(text: TextView): Boolean = live.containsKey(text)

  fun callbackFor(text: TextView): SelectionLifeCallback? = live[text]

  /** [text]'s selection opened: the callbacks of every other one, for the opener to drop. */
  fun opened(text: TextView, callback: SelectionLifeCallback): List<SelectionLifeCallback> {
    val others = live.filterKeys { it !== text }.values.toList()
    live[text] = callback
    return others
  }

  fun closed(text: TextView, callback: SelectionLifeCallback) {
    if (live[text] === callback) {
      live.remove(text)
    }
  }
}
