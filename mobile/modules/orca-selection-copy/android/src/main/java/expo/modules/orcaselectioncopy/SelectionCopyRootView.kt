package expo.modules.orcaselectioncopy

import android.content.Context
import android.graphics.Rect
import android.util.Log
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import com.facebook.react.views.view.ReactViewGroup
import expo.modules.kotlin.viewevent.EventDispatcher

/**
 * Wraps a Markdown document on Android (markdown-selection-copy.android.tsx) and gives each Text
 * inside it, the reply's native prose view included, the chat's selection: a menu of only Copy
 * and Select all (ChatSelectionMenu.kt), handles and highlight in the app's accent
 * (ChatSelectionColors.kt), and, for a Text with code pills, a Copy that carries a pill's words
 * instead of U+FFFC (SelectionCopyActionModeCallback.kt).
 *
 * A Text opens its selection menu by asking its ancestors, one by one, through
 * startActionModeForChild, so this view is asked for every Text the document draws: a paragraph's,
 * a quote's, a table cell's, a pill's own. It works in any window (a Modal is a window of its
 * own) and does nothing until someone touches or selects: no listener on each Text. The colours go
 * onto the document's Texts at each touch down (a walk of this one document, skipped for a Text
 * that has them already), before a hold can start a selection, and again when the menu opens. The
 * cost is this one view per document.
 *
 * It wraps the document's root View and never stands in for it: expo-modules-core 57.0.16 makes
 * each child of an Expo view keep its own children unless collapsableChildren={false}, the
 * opposite of a View, and a prose Text that kept its pill Views would crash the mount (Fabric
 * cannot put a view inside a TextView). A ReactViewGroup, so it lays out, clips and hit-tests its
 * one child as a View does.
 *
 * It also tells the JavaScript when a Text inside holds a selection: `onSelectionChange` with
 * `active` true when the selection's action mode opens and false when it closes. The chat
 * switches `selectable` off while its list scrolls, and off ends a selection
 * (setTextIsSelectable(false) re-sets the text with none), so the first scroll after a hold
 * wiped what the reader was copying (the user, 2026-10-14). Knowing one is open, the chat leaves
 * it alone (chat-text-selectable-context.ts).
 *
 * That still raced the JavaScript: on 0.9.139 the user's selection was gone after one drag. So the
 * scroll's guard is now this view's, and it never touches selectability: while [holdSelects] is
 * false the Texts below are not long-clickable, which is how a hold starts a selection (and plays
 * its haptic), while an open selection, its highlight and its handles do not need the flag. The
 * JavaScript keeps every Text selectable once this view is in the tree (MobileMarkdown.tsx).
 * Each way a selection ends here is logged under OrcaSelectionCopy (rule 9).
 */
class SelectionCopyRootView(context: Context) : ReactViewGroup(context) {
  private val colors = ChatSelectionColors()
  private val onSelectionChange by EventDispatcher()
  private var holdSelects = true

  /** False while the chat scrolls: a hold below starts no selection (see the class note). */
  fun setHoldSelects(holds: Boolean) {
    if (holdSelects == holds) {
      return
    }
    holdSelects = holds
    applyHoldSelects(this)
  }

  /** Every selectable TextView at or under [view] long-clickable exactly when a hold may select.
   *  Only selectable ones: a code pill's Text is neither, so a touch falls through it to the prose. */
  private fun applyHoldSelects(view: View) {
    if (view is TextView && view.isTextSelectable && view.isLongClickable != holdSelects) {
      view.isLongClickable = holdSelects
    }
    if (view is ViewGroup) {
      for (index in 0 until view.childCount) {
        applyHoldSelects(view.getChildAt(index))
      }
    }
  }

  fun setSelectionHandleColor(color: Int?) {
    if (colors.set(color, colors.highlight)) {
      colors.applyBelow(this)
    }
  }

  fun setSelectionHighlightColor(color: Int?) {
    if (colors.set(colors.handle, color)) {
      colors.applyBelow(this)
    }
  }

  override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
    if (ev.actionMasked == MotionEvent.ACTION_DOWN) {
      colors.applyBelow(this)
      // A Text mounted since the flag last changed starts long-clickable; the down comes here first.
      applyHoldSelects(this)
    }
    return super.onInterceptTouchEvent(ev)
  }

  override fun startActionModeForChild(originalView: View?, callback: ActionMode.Callback?, type: Int): ActionMode? {
    val menu =
      try {
        if (originalView is TextView && callback != null) {
          colors.applyBelow(originalView)
          val copying =
            if (InlineViewPlaceholders.any(originalView.text)) {
              SelectionCopyActionModeCallback(originalView, callback)
            } else {
              callback
            }
          ChatSelectionMenuCallback(copying)
        } else {
          callback
        }
      } catch (error: Exception) {
        keptOwnMenu(error)
        callback
      } catch (error: LinkageError) {
        keptOwnMenu(error)
        callback
      }
    if (originalView !is TextView || menu == null) {
      return super.startActionModeForChild(originalView, menu, type)
    }
    return super.startActionModeForChild(originalView, SelectionLifeCallback(menu, originalView) { active -> selectionChanged(active) }, type)
  }

  private fun selectionChanged(active: Boolean) {
    try {
      onSelectionChange(mapOf("active" to active))
    } catch (error: RuntimeException) {
      // The selection itself must never break over this; the chat then behaves as before.
      Log.w("OrcaSelectionCopy", "Could not report a selection ${if (active) "opening" else "closing"}", error)
    }
  }
}

/**
 * A Text's selection menu, unchanged, that says when it opens and closes: a created action mode
 * is a selection on screen, a destroyed one a selection gone (a tap away, a Copy, the Text leaving
 * the window). Everything else is the wrapped menu's.
 */
internal class SelectionLifeCallback(
  private val inner: ActionMode.Callback,
  private val text: TextView,
  private val changed: (Boolean) -> Unit
) : ActionMode.Callback2() {
  override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean {
    val created = inner.onCreateActionMode(mode, menu)
    if (created) {
      Log.i("OrcaSelectionCopy", "Selection opened in ${text.javaClass.simpleName} (${text.selectionEnd - text.selectionStart} chars)")
      changed(true)
    }
    return created
  }

  override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean = inner.onPrepareActionMode(mode, menu)

  override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean = inner.onActionItemClicked(mode, item)

  override fun onDestroyActionMode(mode: ActionMode) {
    inner.onDestroyActionMode(mode)
    // Whether the words are still selected says who ended it: a tap away or a Copy clears them,
    // the platform closing only its menu (a scroll on some builds) leaves them.
    Log.i("OrcaSelectionCopy", "Selection menu closed in ${text.javaClass.simpleName}: hasSelection=${text.hasSelection()} attached=${text.isAttachedToWindow}")
    changed(false)
  }

  // The floating toolbar sits over the selection only if the wrapped menu still places it.
  override fun onGetContentRect(mode: ActionMode, view: View, outRect: Rect) {
    val placed = inner as? ActionMode.Callback2
    if (placed != null) {
      placed.onGetContentRect(mode, view, outRect)
    } else {
      super.onGetContentRect(mode, view, outRect)
    }
  }
}

/** Selecting must never break over this: the Text keeps its own menu, and the log says why. */
private fun keptOwnMenu(error: Throwable) {
  Log.w("OrcaSelectionCopy", "Kept a Text's own selection menu", error)
}
