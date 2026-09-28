package expo.modules.orcaselectioncopy

import android.content.Context
import android.util.Log
import android.view.ActionMode
import android.view.View
import android.widget.TextView
import com.facebook.react.views.view.ReactViewGroup

/**
 * Wraps a Markdown document on Android (markdown-selection-copy.android.tsx) and gives each Text
 * inside it a selection menu whose Copy and Share carry a code pill's words instead of U+FFFC
 * (SelectionCopyActionModeCallback.kt).
 *
 * A Text opens its selection menu by asking its ancestors, one by one, through
 * startActionModeForChild, so this view is asked for every Text the document draws: a paragraph's,
 * a quote's, a table cell's, a pill's own. It works in any window (a Modal is a window of its
 * own) and does nothing until someone selects: no listener on each Text, no walk of the tree. A
 * Text with no inline View is handed back its own menu, unwrapped. The cost is this one view per
 * document.
 *
 * It wraps the document's root View and never stands in for it: expo-modules-core 57.0.16 makes
 * each child of an Expo view keep its own children unless collapsableChildren={false}, the
 * opposite of a View, and a prose Text that kept its pill Views would crash the mount (Fabric
 * cannot put a view inside a TextView). A ReactViewGroup, so it lays out, clips and hit-tests its
 * one child as a View does.
 */
class SelectionCopyRootView(context: Context) : ReactViewGroup(context) {
  override fun startActionModeForChild(originalView: View?, callback: ActionMode.Callback?, type: Int): ActionMode? {
    val menu =
      try {
        if (originalView is TextView && callback != null && InlineViewPlaceholders.any(originalView.text)) {
          SelectionCopyActionModeCallback(originalView, callback)
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
    return super.startActionModeForChild(originalView, menu, type)
  }
}

/** Selecting must never break over this: the Text keeps its own menu, and the log says why. */
private fun keptOwnMenu(error: Throwable) {
  Log.w("OrcaSelectionCopy", "Kept a Text's own selection menu", error)
}
