package expo.modules.orcaselectioncopy

import android.widget.TextView
import java.util.WeakHashMap
import kotlin.math.max
import kotlin.math.min

/**
 * A selection the chat can do nothing with: words lit in a Text with no menu standing for them.
 *
 * Android selects the word under a long press at once and opens its menu only when the finger
 * lifts (Editor.selectCurrentWordAndStartDrag, then startSelectionActionModeAsync at ACTION_UP).
 * The chat's scroll view is a gesture-handler Gesture.Native(), which asks the ScrollView to
 * intercept directly (NativeViewGestureHandler.tryIntercept, react-native-gesture-handler 2.32.0)
 * whatever the Text asked with requestDisallowInterceptTouchEvent, and from then on passes the views
 * below nothing more of that gesture, and its ACTION_CANCEL only at the next finger down
 * (ViewGroup.cancelAndClearTouchTargets; ScrollTakesHold.kt). So a finger that
 * lands on a Text and scrolls the list gets no lift, the long press armed at its down goes off
 * mid-scroll unless the root cancels it first, and the word stays lit with no menu: seen on the
 * user's phone on 2026-10-15 (0.9.150) as the highlight landing on "pictures" and on a table
 * cell's "used" as the chat scrolled, with no "Selection opened" line in the log for either. The
 * document's root clears such a selection (SelectionCopyRootView.sweepStrays), armed when the list
 * moves the document under the finger before the hold went off (scrollTookTouch), or when a
 * cancel or lift does arrive.
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
 * Which touch gesture is under way, so a sweep armed by one gesture never runs in a later one.
 *
 * Review of 1245b7fdd: every lift armed a sweep 2.5 s later that belonged to no gesture. A reader
 * who tapped to stop a fling and pressed a word 1.6 to 2.0 s later saw the long press light it, and
 * the tap's sweep then found lit words with no menu (that opens only at the lift) and cleared them
 * under the finger. A sweep is due only while the gesture that armed it is still the last one
 * ([gesture] unchanged) and its finger is up. Main thread only.
 */
internal class GestureClock {
  /** Counts finger downs: each new gesture gets the next number. */
  var gesture = 0
    private set
  private var touching = false

  /** A finger went down: a new gesture, whose number is returned. */
  fun down(): Int {
    gesture += 1
    touching = true
    return gesture
  }

  /** The gesture's finger lifted or the touch was taken (ACTION_UP or ACTION_CANCEL). */
  fun ended() {
    touching = false
  }

  /** Whether a sweep armed in gesture [armed] may still run. */
  fun stillDue(armed: Int): Boolean = armed == gesture && !touching
}

/**
 * Selections put back (restoreHeld, reselect) whose action mode has not opened yet. Until it does
 * they are lit words with no menu, which is exactly what a sweep clears, so a sweep takes one for
 * live while the same range is still selected. Any other range, or none, forgets the restore: the
 * reader moved on, and the same words lit later by a stray hold are a stray again. Weakly keyed, so
 * a Text that goes before its menu opens is not kept by this. Main thread only.
 */
internal class AwaitingMenu<K : Any> {
  private val restored = WeakHashMap<K, SelectedRange>()

  fun restored(key: K, range: SelectedRange) {
    restored[key] = range
  }

  fun isAwaiting(key: K, current: SelectedRange?): Boolean {
    val range = restored[key] ?: return false
    if (range == current) {
      return true
    }
    restored.remove(key)
    return false
  }

  fun forget(key: K) {
    restored.remove(key)
  }
}

/**
 * The chat's selections that have their menu (or had it and are still selected), each with the
 * callback watching it ([SelectionLifeCallback]). One at a time, as Android means it: one opening
 * drops the others, which a selection in a second Text, or in a second document, never did by
 * itself. An entry leaves when its callback stops watching, which it also does when its Text
 * leaves the window, so this static map never keeps a dead Text (and its Context). Main thread only.
 */
internal object LiveSelections {
  private val live = HashMap<TextView, SelectionLifeCallback>()
  private val awaitingMenu = AwaitingMenu<TextView>()

  /** Whether [text]'s selection [current] is the chat's: it has its menu, or was put back and awaits it. */
  fun isLive(text: TextView, current: SelectedRange?): Boolean =
    live.containsKey(text) || awaitingMenu.isAwaiting(text, current)

  /** [text]'s selection was put back at [range]; its menu opens asynchronously. */
  fun restored(text: TextView, range: SelectedRange) {
    awaitingMenu.restored(text, range)
  }

  fun callbackFor(text: TextView): SelectionLifeCallback? = live[text]

  /** [text]'s selection opened: the callbacks of every other one, for the opener to drop. */
  fun opened(text: TextView, callback: SelectionLifeCallback): List<SelectionLifeCallback> {
    awaitingMenu.forget(text)
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
