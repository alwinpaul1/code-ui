package expo.modules.orcaselectioncopy

import android.content.Context
import android.graphics.Rect
import android.text.Selection
import android.text.Spannable
import android.util.Log
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.ViewConfiguration
import android.view.ViewTreeObserver
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
  private companion object {
    /** How long after a lift the words a hold lit may wait for their menu before they are a stray. */
    const val STRAY_GRACE_MS = 2_500L
  }

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

  // Where and when the last touch below lifted, for [isRepeatTap].
  private var lastUpAt: Long? = null
  private var lastUpX = 0f
  private var lastUpY = 0f
  private var tookRepeatTap = false

  // The gesture under way: where and when its finger went down, what each Text below held then
  // (so a selection the reader already had is never taken for this gesture's stray), and whether
  // its pending hold has been cancelled as a drag.
  private var downX = 0f
  private var downY = 0f
  private var downAt = 0L
  private var selectedAtDown: Map<TextView, SelectedRange> = emptyMap()
  private var holdCancelled = false

  // Which gesture is under way, and the sweep the last one armed: a sweep runs only in the gesture
  // that armed it, never under a later finger ([GestureClock]).
  private val gestures = GestureClock()
  private var pendingSweep: Runnable? = null

  override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
    // Every touch passes here, whichever view ends up handling it, so the lift is always seen.
    when (ev.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        // A new gesture: the last one's sweep is not this one's (a tap to stop a fling, then a
        // hold, must not lose the hold's word to the tap's sweep).
        gestures.down()
        // The cancelled sweep's baseline carries over: words the last gesture lit that still have
        // no menu stay strays for this gesture's sweep, instead of counting as held at this down.
        val unswept = cancelPendingSweep()
        downX = ev.x
        downY = ev.y
        downAt = ev.eventTime
        holdCancelled = false
        selectedAtDown = unswept ?: selectionsBelow()
      }
      MotionEvent.ACTION_MOVE -> {
        // A finger that moved before the long-press timeout is a drag, not a hold, as a Compose
        // long press is cancelled by moving. A Text's own long press ends only when the finger
        // leaves its bounds or the scroll view takes the touch, and a sideways start never does.
        if (!holdCancelled && ev.eventTime - downAt < ViewConfiguration.getLongPressTimeout() &&
          movedPastSlop(downX, downY, ev.x, ev.y, ViewConfiguration.get(context).scaledTouchSlop.toFloat())) {
          holdCancelled = true
          cancelPendingHolds()
        }
      }
      MotionEvent.ACTION_UP -> {
        lastUpAt = ev.eventTime
        lastUpX = ev.x
        lastUpY = ev.y
        gestures.ended()
        // A hold's menu opens after the lift, once the text classifier answers (0.5 s on the
        // user's S23, 2026-10-15); words this gesture lit that still have none by then never will.
        postDelayed(armSweep(gestures.gesture, "no menu opened $STRAY_GRACE_MS ms after the finger lifted"), STRAY_GRACE_MS)
      }
      MotionEvent.ACTION_CANCEL -> {
        gestures.ended()
        // The scroll took the touch: a word a hold lit before it did will never get its menu.
        post(armSweep(gestures.gesture, "the touch went to the scroll before a menu opened"))
      }
    }
    return super.dispatchTouchEvent(ev)
  }

  /** The sweep for gesture [armed], kept as [pendingSweep] so the next finger down cancels it. It
   *  also checks the gesture when it runs, in case it was already queued when that finger came. */
  private fun armSweep(armed: Int, why: String): Runnable {
    cancelPendingSweep()
    val before = selectedAtDown
    val sweep =
      Runnable {
        pendingSweep = null
        pendingSweepBefore = null
        if (!gestures.stillDue(armed)) {
          return@Runnable
        }
        sweepStrays(before, why)
      }
    pendingSweep = sweep
    pendingSweepBefore = before
    return sweep
  }

  // What the pending sweep compares against, handed to the next gesture if it is cancelled.
  private var pendingSweepBefore: Map<TextView, SelectedRange>? = null

  /** Cancels the pending sweep, if any, and returns the baseline it would have compared against. */
  private fun cancelPendingSweep(): Map<TextView, SelectedRange>? {
    val before = pendingSweepBefore
    pendingSweep?.let { removeCallbacks(it) }
    pendingSweep = null
    pendingSweepBefore = null
    return before
  }

  override fun onDetachedFromWindow() {
    // A sweep left queued would walk a document no longer on screen.
    cancelPendingSweep()
    super.onDetachedFromWindow()
  }

  /** What each Text below holds selected now; a Text with nothing selected is left out. */
  private fun selectionsBelow(): Map<TextView, SelectedRange> {
    val held = HashMap<TextView, SelectedRange>()
    for (text in textViewsBelow(this)) {
      selectedRangeIn(text)?.let { held[text] = it }
    }
    return held
  }

  private fun cancelPendingHolds() {
    for (text in textViewsBelow(this)) {
      text.cancelLongPress()
    }
  }

  /** Clears each selection below that the gesture made and that has no menu ([isStraySelection]).
   *  One put back and still waiting for its menu counts as having it ([LiveSelections.isLive]). */
  private fun sweepStrays(before: Map<TextView, SelectedRange>, why: String) {
    for (text in textViewsBelow(this)) {
      val after = selectedRangeIn(text)
      if (after != null && isStraySelection(before[text], after, LiveSelections.isLive(text, after))) {
        (text.text as? Spannable)?.let { Selection.removeSelection(it) }
        Log.w("OrcaSelectionCopy", "Cleared ${after.end - after.start} selected chars with no menu in ${text.javaClass.simpleName}: $why")
      }
    }
  }

  /** The chat document this view draws (MobileMarkdown's `identity`); null outside the chat. */
  private var documentKey: String? = null

  /**
   * The list handed this row to another message: a selection held below belongs to the one it
   * left, so it is dropped rather than put back on whatever words now stand at its place
   * ([SelectionLifeCallback] puts one back after new text wherever the same words stand there,
   * and another message can repeat them). The chat keeps the held selection outside the rows and
   * sends it back to the row whose key matches (`restoreSelection`).
   */
  fun setDocumentKey(key: String?) {
    val was = documentKey
    documentKey = key
    if (was == null || was == key) {
      return
    }
    for (text in textViewsBelow(this)) {
      LiveSelections.callbackFor(text)?.drop("its row now draws another message")
    }
  }

  override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
    if (ev.actionMasked == MotionEvent.ACTION_DOWN) {
      colors.applyBelow(this)
      // A Text mounted since the flag last changed starts long-clickable; the down comes here first.
      applyHoldSelects(this)
      // The second touch of a double tap selects the word under it in a TextView (Editor's
      // SelectionModifierCursorController, at ACTION_DOWN), and a reader who taps to stop a fling
      // and touches again to scroll on makes one: single stray words lit up all over the chat
      // (2026-10-14 17:21). The Claude app selects on a hold only, so the Texts never see it.
      val config = ViewConfiguration.get(context)
      if (isRepeatTap(lastUpAt, lastUpX, lastUpY, ev.eventTime, ev.x, ev.y,
          ViewConfiguration.getDoubleTapTimeout().toLong(), config.scaledDoubleTapSlop.toFloat())) {
        Log.i("OrcaSelectionCopy", "Kept a double tap from selecting a word")
        tookRepeatTap = true
        return true
      }
    }
    return super.onInterceptTouchEvent(ev)
  }

  // A touch taken from the Texts above is not this view's either: it goes on up to the scroll view.
  // Any other touch that lands here is handled as a React view handles it.
  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (event.actionMasked == MotionEvent.ACTION_DOWN && tookRepeatTap) {
      tookRepeatTap = false
      return false
    }
    return super.onTouchEvent(event)
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
    val run = textViewsBelow(this).indexOf(originalView)
    return super.startActionModeForChild(originalView, SelectionLifeCallback(menu, originalView, run, ::selectionChanged), type)
  }

  private fun selectionChanged(active: Boolean, held: HeldSelection?) {
    try {
      val payload: Map<String, Any> =
        if (held == null) {
          mapOf("active" to active)
        } else {
          mapOf("active" to active, "run" to held.run, "start" to held.start, "end" to held.end, "words" to held.words)
        }
      onSelectionChange(payload)
    } catch (error: RuntimeException) {
      // The selection itself must never break over this; the chat then behaves as before.
      Log.w("OrcaSelectionCopy", "Could not report a selection ${if (active) "opening" else "closing"}", error)
    }
  }

  /** A selection this document held before its row went away (chat-held-selection.ts), to put
   *  back once its Text is drawn; null when there is none, or it is back. */
  private var pendingRestore: HeldSelection? = null

  internal fun setRestoreSelection(held: HeldSelection?) {
    pendingRestore = held
    if (held != null) {
      post { restoreHeld() }
    }
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    super.onLayout(changed, l, t, r, b)
    if (pendingRestore != null) {
      post { restoreHeld() }
    }
  }

  /** Puts [pendingRestore] back on the Text it was in, if that Text draws the same words there. */
  private fun restoreHeld() {
    val held = pendingRestore ?: return
    val text = textViewsBelow(this).getOrNull(held.run) ?: return
    if (text.text.length < held.end || text.width == 0) {
      // Not drawn yet (or still streaming in): the next layout tries again.
      return
    }
    pendingRestore = null
    if (reselect(text, held)) {
      Log.i("OrcaSelectionCopy", "Selection put back on a row drawn again (${held.end - held.start} chars)")
    } else {
      Log.w("OrcaSelectionCopy", "Selection not put back: its words no longer stand where they were")
    }
  }
}

/** Every TextView at or under [view], in drawing order: how a selection names its Text ([HeldSelection.run]). */
internal fun textViewsBelow(view: View): List<TextView> {
  val found = ArrayList<TextView>()
  fun walk(at: View) {
    if (at is TextView) {
      found.add(at)
    }
    if (at is ViewGroup) {
      for (index in 0 until at.childCount) {
        walk(at.getChildAt(index))
      }
    }
  }
  walk(view)
  return found
}

/**
 * A Text's selection menu, unchanged, that reports the selection it stands for: opened, moved by
 * its handles, closed. Everything else is the wrapped menu's.
 *
 * It watches the selection before each frame for as long as its words are selected, menu or not:
 * - The Text was given new text (a streaming reply grew, a list reused the view). Android ends a
 *   selection on any new text; where the selected words still stand at the same place
 *   ([selectionStillHolds]) the selection is put back with its menu ([reselect]), as the Claude app
 *   keeps a selection while a reply grows. Where they do not (another message's words, an edit
 *   inside the range) it is dropped, the menu closed, and the log says so (FlashList handed the
 *   view to another message on 2026-10-14 13:30 and the highlight came back on other words).
 * - The reader dragged a handle: the new range is reported, so the chat holds the words they mean.
 * - The words are no longer selected (a tap away, a Copy): reported closed.
 */
internal class SelectionLifeCallback(
  private val inner: ActionMode.Callback,
  private val text: TextView,
  private val run: Int,
  private val report: (Boolean, HeldSelection?) -> Unit
) : ActionMode.Callback2(), ViewTreeObserver.OnPreDrawListener, View.OnAttachStateChangeListener {
  private var held: HeldSelection? = null
  // The words the Text drew when last looked at: a re-render that sets the same words is no change.
  private var lastText: String? = null
  private var liveMode: ActionMode? = null
  private var observer: ViewTreeObserver? = null

  override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean {
    val created = inner.onCreateActionMode(mode, menu)
    if (created) {
      Log.i("OrcaSelectionCopy", "Selection opened in ${text.javaClass.simpleName} (${text.selectionEnd - text.selectionStart} chars)")
      held = heldSelectionIn(text, run)
      lastText = text.text.toString()
      liveMode = mode
      observer = text.viewTreeObserver.also { it.addOnPreDrawListener(this) }
      // Leaving the window ends the watch, so LiveSelections (static) never keeps a dead Text.
      text.addOnAttachStateChangeListener(this)
      // One selection at a time: a Text that kept its highlight when this one opened elsewhere
      // holds words the reader is no longer copying.
      LiveSelections.opened(text, this).forEach { it.drop("another selection opened") }
      report(true, held)
    }
    return created
  }

  override fun onPreDraw(): Boolean {
    val held = held ?: return true
    val now = text.text.toString()
    if (now != lastText) {
      lastText = now
      if (selectionStillHolds(held.words, held.start, held.end, text.text)) {
        // A new action mode comes with the reselect, and its own callback reports and watches.
        stopWatching()
        reselect(text, held)
      } else {
        Log.w("OrcaSelectionCopy", "Selection dropped: its words changed under it (${text.javaClass.simpleName})")
        (text.text as? Spannable)?.let { Selection.removeSelection(it) }
        val mode = liveMode
        stopWatching()
        mode?.finish()
        report(false, null)
      }
      return true
    }
    val current = heldSelectionIn(text, run)
    if (current == null) {
      if (liveMode == null) {
        stopWatching()
        report(false, null)
      }
    } else if (current != held) {
      moved(current)
    }
    return true
  }

  /** Ends this selection, highlight and menu, and says why in the log (rule 9). */
  fun drop(why: String) {
    Log.w("OrcaSelectionCopy", "Selection dropped in ${text.javaClass.simpleName}: $why")
    if (!text.isAttachedToWindow) {
      // A Text already gone: its mode went with it, and its document reports nothing any more.
      stopWatching()
      return
    }
    (text.text as? Spannable)?.let { Selection.removeSelection(it) }
    val mode = liveMode
    stopWatching()
    if (mode != null) {
      // Its close (onDestroyActionMode) reports the selection gone.
      mode.finish()
    } else {
      report(false, null)
    }
  }

  private fun moved(current: HeldSelection) {
    held = current
    report(true, current)
  }

  override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean = inner.onPrepareActionMode(mode, menu)

  override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean = inner.onActionItemClicked(mode, item)

  override fun onDestroyActionMode(mode: ActionMode) {
    inner.onDestroyActionMode(mode)
    // Whether the words are still selected says who ended it: a tap away clears them, new text
    // ends the mode under them, and the platform may close only its menu.
    Log.i("OrcaSelectionCopy", "Selection menu closed in ${text.javaClass.simpleName}: hasSelection=${text.hasSelection()} attached=${text.isAttachedToWindow}")
    liveMode = null
    val held = held
    if (held != null && text.text.toString() != lastText && selectionStillHolds(held.words, held.start, held.end, text.text)) {
      // New text ended it and the words still stand: put it back once the text is in.
      stopWatching()
      text.post { reselect(text, held) }
      return
    }
    if (held != null && text.isAttachedToWindow && text.hasSelection()) {
      // The menu went, the words are still selected: keep watching until they are not.
      return
    }
    stopWatching()
    report(false, null)
  }

  override fun onViewAttachedToWindow(view: View) = Unit

  /** The Text left the window (its row or its document went): stop watching without reporting,
   *  so the chat keeps the selection to put back where the message draws again. */
  override fun onViewDetachedFromWindow(view: View) {
    Log.i("OrcaSelectionCopy", "Stopped watching a selection: its ${text.javaClass.simpleName} left the window")
    stopWatching()
  }

  private fun stopWatching() {
    held = null
    LiveSelections.closed(text, this)
    text.removeOnAttachStateChangeListener(this)
    // The observer it was added to, if still alive; a re-attached view has a new one.
    val added = observer?.takeIf { it.isAlive } ?: text.viewTreeObserver
    observer = null
    added.removeOnPreDrawListener(this)
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
