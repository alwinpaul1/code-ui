package expo.modules.orcaselectioncopy

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.graphics.Rect
import android.text.ParcelableSpan
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.CharacterStyle
import android.util.Log
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.widget.TextView
import com.facebook.react.bridge.ReactContext
import com.facebook.react.uimanager.UIManagerHelper

private const val TAG = "OrcaSelectionCopy"

/**
 * A Text's own selection menu, with Copy and Share giving each code pill's words in place of its
 * U+FFFC (PillCopy.kt). Every other item, and Copy or Share of a selection that holds no pill,
 * goes to the Text's menu untouched, as does anything that fails here: the worst this can do is
 * the copy the Text would have made anyway.
 */
internal class SelectionCopyActionModeCallback(
  private val textView: TextView,
  private val menu: ActionMode.Callback
) : ActionMode.Callback2() {
  override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean =
    this.menu.onCreateActionMode(mode, menu)

  override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean =
    this.menu.onPrepareActionMode(mode, menu)

  override fun onDestroyActionMode(mode: ActionMode) {
    menu.onDestroyActionMode(mode)
  }

  // The floating toolbar sits over the selection only if the Text's menu still places it.
  override fun onGetContentRect(mode: ActionMode, view: View, outRect: Rect) {
    val placed = menu as? ActionMode.Callback2
    if (placed != null) {
      placed.onGetContentRect(mode, view, outRect)
    } else {
      super.onGetContentRect(mode, view, outRect)
    }
  }

  override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean {
    val handled =
      try {
        when (item.itemId) {
          android.R.id.copy -> copy(mode)
          android.R.id.shareText -> share(mode)
          else -> false
        }
      } catch (error: Exception) {
        Log.w(TAG, "Selection ${item.title} with pills fell back to the Text's own", error)
        false
      } catch (error: LinkageError) {
        Log.w(TAG, "Selection ${item.title} with pills fell back to the Text's own", error)
        false
      }
    return handled || menu.onActionItemClicked(mode, item)
  }

  /** As TextView copies (ClipData.newPlainText of the selection, TextView.java ID_COPY), then
   *  closes the menu as it does. False, and the Text copies, when there is no pill to swap. */
  private fun copy(mode: ActionMode): Boolean {
    val selection = selectionWithPills() ?: return false
    val clipboard = textView.context.getSystemService(ClipboardManager::class.java) ?: return false
    clipboard.setPrimaryClip(ClipData.newPlainText(null, selection))
    mode.finish()
    return true
  }

  /** As TextView shares (ACTION_SEND of the selected text through a chooser). */
  private fun share(mode: ActionMode): Boolean {
    val selection = selectionWithPills()?.toString() ?: return false
    if (selection.isEmpty()) {
      return false
    }
    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, selection)
    textView.context.startActivity(Intent.createChooser(send, null))
    mode.finish()
    return true
  }

  /** The selected characters with each pill's U+FFFC swapped for its words, or null when there is
   *  no pill to swap (no inline View in the selection, or only ones that are not pills, such as a
   *  figure): then the Text's own copy is what it always was. */
  private fun selectionWithPills(): CharSequence? {
    val text = textView.text as? Spanned ?: return null
    val range = selectionRange(textView.selectionStart, textView.selectionEnd, text.length)
    if (range.isEmpty()) {
      return null
    }
    val found = InlineViewPlaceholders.find(text, range.first, range.last + 1)
    if (found.isEmpty()) {
      return null
    }
    val placeholders =
      (found.indices step 2).map { at ->
        val index = found[at]
        InlinePlaceholder(index, pillAt(tag = found[at + 1], index = index, length = text.length))
      }
    val plan = planPillCopy(text, range.first, range.last + 1, placeholders)
    if (plan.replacements.isEmpty()) {
      return null
    }
    val copy = clipOf(text, range.first, range.last + 1)
    plan.applyTo(range.first) { from, to, with -> copy.replace(from, to, with) }
    return copy
  }

  /**
   * The selected characters with the spans a clip carries to whoever pastes it, and no others.
   *
   * The clipboard hands a clip over as a parcel, which keeps only framework ParcelableSpans, each
   * CharacterStyle unwrapped first (TextUtils.writeToParcel): a colour or a size, never a watcher.
   * Not SpannableStringBuilder(text, start, end), which also copies the TextView's ChangeWatcher (a
   * TextWatcher and SpanWatcher, not a NoCopySpan, TextView.java): each replace below would then
   * call back into the live Text in the middle of its menu.
   */
  private fun clipOf(text: Spanned, start: Int, end: Int): SpannableStringBuilder {
    val clip = SpannableStringBuilder(text.subSequence(start, end).toString())
    for (span in text.getSpans(start, end, Any::class.java)) {
      val carried = if (span is CharacterStyle) span.underlying else span
      if (carried !is ParcelableSpan) {
        continue
      }
      val from = maxOf(text.getSpanStart(span), start) - start
      val to = minOf(text.getSpanEnd(span), end) - start
      if (from >= to) {
        continue
      }
      // A paragraph span cut by the selection no longer starts or ends a paragraph, which
      // setSpan refuses; its reach is what matters in a clip.
      val flags = text.getSpanFlags(span)
      val kept =
        if (flags and Spanned.SPAN_POINT_MARK_MASK == Spanned.SPAN_PARAGRAPH) {
          (flags and Spanned.SPAN_POINT_MARK_MASK.inv()) or Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
        } else {
          flags
        }
      clip.setSpan(span, from, to, kept)
    }
    return clip
  }

  /** The copy text of the inline View with this tag, from its nativeID. Null, with one line in the
   *  log saying why, when there is none: that placeholder is copied as U+FFFC. */
  private fun pillAt(tag: Int, index: Int, length: Int): PillCopyText? {
    val why: String
    val context = textView.context as? ReactContext
    val view =
      context?.let {
        try {
          UIManagerHelper.getUIManagerForReactTag(it, tag)?.resolveView(tag)
        } catch (error: RuntimeException) {
          null
        }
      }
    if (view == null) {
      why = if (context == null) "the Text is not in a React context" else "view $tag is not mounted"
    } else {
      val nativeId = view.getTag(com.facebook.react.R.id.view_tag_native_id) as? String
      val pill = PillCopyText.fromNativeId(nativeId)
      if (pill != null) {
        return pill
      }
      why =
        if (nativeId == null) {
          "view $tag (${view.javaClass.simpleName}) has no nativeID, so it is not a code pill"
        } else {
          "view $tag has nativeID \"${nativeId.take(16)}…\", which is not a pill's copy text"
        }
    }
    Log.w(TAG, "Copy kept U+FFFC at $index of a $length-character Text: $why")
    return null
  }
}
