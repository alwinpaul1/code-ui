package expo.modules.orcaselectioncopy

import android.graphics.drawable.Drawable
import android.os.Build
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import java.util.WeakHashMap

/**
 * The colours of a selection in a chat reply: the handles and the highlight, from the app's own
 * theme accent, in whichever scheme the app shows (markdown-selection-copy.android.tsx passes them,
 * chat-selection-colors.ts says what they are).
 *
 * The Claude app's are Compose TextSelectionColors (`k4y`), built in its theme (`bek.a`) from the
 * colour scheme's primary: the handles in it, the highlight the same colour at 40%. Without this a
 * TextView draws the platform's own: the theme's control colour on the handles and
 * textColorHighlight behind the words (teal and teal-grey on the user's phone, 2026-10-12).
 *
 * The highlight is set on any API level. The handles take a tinted copy of the TextView's own
 * handle drawables, which only API 29 and later can set (TextView.setTextSelectHandle*); below it
 * they keep the platform's colour.
 */
internal class ChatSelectionColors {
  var handle: Int? = null
    private set
  var highlight: Int? = null
    private set

  /** What each TextView was last given, so a touch does not set the same drawables again. */
  private val applied = WeakHashMap<TextView, Pair<Int?, Int?>>()

  /** Returns whether anything changed. */
  fun set(handle: Int?, highlight: Int?): Boolean {
    if (this.handle == handle && this.highlight == highlight) {
      return false
    }
    this.handle = handle
    this.highlight = highlight
    return true
  }

  /** Gives every TextView at or under [view] these colours. */
  fun applyBelow(view: View) {
    if (handle == null && highlight == null) {
      return
    }
    try {
      walk(view)
    } catch (error: RuntimeException) {
      // The selection still works in the platform's colours; the log says why.
      Log.w("OrcaSelectionCopy", "Kept the platform's selection colours", error)
    }
  }

  private fun walk(view: View) {
    if (view is TextView) {
      applyTo(view)
    }
    if (view is ViewGroup) {
      for (index in 0 until view.childCount) {
        walk(view.getChildAt(index))
      }
    }
  }

  fun applyTo(textView: TextView) {
    val wanted = handle to highlight
    if (applied[textView] == wanted) {
      return
    }
    highlight?.let { textView.highlightColor = it }
    val color = handle
    if (color != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      tinted(textView.textSelectHandleLeft, color)?.let { textView.setTextSelectHandleLeft(it) }
      tinted(textView.textSelectHandleRight, color)?.let { textView.setTextSelectHandleRight(it) }
      tinted(textView.textSelectHandle, color)?.let { textView.setTextSelectHandle(it) }
    }
    applied[textView] = wanted
  }

  // Mutated, so the tint stays on this TextView's handles and not on every user of the resource.
  private fun tinted(drawable: Drawable?, color: Int): Drawable? = drawable?.mutate()?.apply { setTint(color) }
}

/** A colour the JavaScript sent through processColor, signed or not, as an Android colour int. */
internal fun colorIntOf(value: Double?): Int? = value?.toLong()?.toInt()
