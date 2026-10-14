package expo.modules.orcaselectioncopy

import android.os.Bundle
import android.text.Selection
import android.text.Spannable
import android.util.Log
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.TextView

/**
 * Where a chat selection is, kept so it can be put back: which Text of a document ([run], in the
 * order [textViewsBelow] walks them), the range, and the words it held. The JavaScript keeps one
 * outside the rows (chat-held-selection.ts), as the Claude app keeps its SelectionState outside
 * the LazyColumn's items, and sends it back to a row that is drawn again (`restoreSelection`).
 */
internal data class HeldSelection(val run: Int, val start: Int, val end: Int, val words: String)

/**
 * Whether a selection of [words] at [start]..[end] still has its words in [text], at the same
 * place. A Text given new text has lost its selection; it is put back only here, so a streaming
 * reply that grew keeps it, and a selection never lands on words nobody selected (a reply edited
 * under it, words shifted along, another message's text).
 */
internal fun selectionStillHolds(words: String, start: Int, end: Int, text: CharSequence): Boolean =
  start in 0 until end && end <= text.length && words.length == end - start &&
    text.subSequence(start, end).toString() == words

/** A restore the JavaScript sent, or null for anything that is not one. */
internal fun heldSelectionOf(value: Map<String, Any?>?): HeldSelection? {
  value ?: return null
  val run = (value["run"] as? Number)?.toInt() ?: return null
  val start = (value["start"] as? Number)?.toInt() ?: return null
  val end = (value["end"] as? Number)?.toInt() ?: return null
  val words = value["words"] as? String ?: return null
  return if (run >= 0 && start in 0 until end) HeldSelection(run, start, end, words) else null
}

/** What [text] holds selected now, as the [run]th Text of its document; null with none. */
internal fun heldSelectionIn(text: TextView, run: Int): HeldSelection? {
  val start = text.selectionStart
  val end = text.selectionEnd
  if (start < 0 || end <= start || end > text.text.length) {
    return null
  }
  return HeldSelection(run, start, end, text.text.subSequence(start, end).toString())
}

/**
 * Selects [held]'s words in [text] again, menu and handles too, if they still stand there.
 *
 * Through the TextView's own accessibility action: it selects, takes focus as a selectable Text
 * must, and starts the TextView's own selection mode (Editor.startSelectionActionModeAsync), which
 * no public call does otherwise, so the handles and the Copy pill come back as a hold would give
 * them. Where that action is refused, the words are still selected, without the menu, and the log
 * says so. Returns whether the words were selected.
 */
internal fun reselect(text: TextView, held: HeldSelection): Boolean {
  val spannable = text.text as? Spannable ?: return false
  if (!text.isTextSelectable || !selectionStillHolds(held.words, held.start, held.end, spannable)) {
    return false
  }
  // The action does nothing for a range already selected; start from none so it engages the mode.
  Selection.removeSelection(spannable)
  val arguments =
    Bundle().apply {
      putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, held.start)
      putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, held.end)
    }
  if (!text.performAccessibilityAction(AccessibilityNodeInfo.ACTION_SET_SELECTION, arguments)) {
    Selection.setSelection(spannable, held.start, held.end)
    Log.w("OrcaSelectionCopy", "Selection put back without its menu: the Text refused ACTION_SET_SELECTION")
  }
  return true
}
