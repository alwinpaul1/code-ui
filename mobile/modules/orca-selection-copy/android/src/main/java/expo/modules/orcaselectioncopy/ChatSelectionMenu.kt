package expo.modules.orcaselectioncopy

import android.graphics.Rect
import android.util.Log
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.View

/**
 * What a selection in a chat reply offers: Copy and Select all, nothing else, as the Claude app's.
 *
 * The Claude app (com.anthropic.claude 1.261009.20) installs its own Compose TextToolbar (`lor`,
 * provided as LocalTextToolbar) that starts a floating ActionMode (`view.startActionMode(n9f,
 * TYPE_FLOATING)`) whose callback (`n9f`) builds the menu from scratch from its `jor` items: Copy
 * (android.R.string.copy) and Select all (android.R.string.selectAll), plus Reply, Read aloud,
 * Share and Web search where the screen has a handler for them. A Code session's transcript shows
 * Copy and Select all. Because Compose's text never goes through a TextView's Editor, none of the
 * items the Editor adds (the text classifier's assist item, Translate and the other PROCESS_TEXT
 * actions, Share, the overflow they spill into) are ever there. The pill is the platform's floating
 * toolbar with those two items in it.
 *
 * A TextView's selection menu is its Editor's, and this keeps its two items and hides the rest,
 * after every create and prepare (the Editor adds assist items again on each prepare). Hidden, not
 * removed: the Editor looks its own items up by id on each prepare (updateSelectAllItem and the
 * like), and a menu it built stays the shape it built. Copy and Select all still run the Editor's
 * own code, so the selection behaves as it always did.
 */

/** The ids a chat selection's menu shows, as the Editor adds them (TextView.ID_COPY, ID_SELECT_ALL). */
internal val CHAT_SELECTION_MENU_ITEMS: Set<Int> = setOf(android.R.id.copy, android.R.id.selectAll)

internal fun keptInChatSelectionMenu(itemId: Int): Boolean = itemId in CHAT_SELECTION_MENU_ITEMS

/** Hides every item of [menu] but Copy and Select all. Returns whether it hid any. */
internal fun keepOnlyChatSelectionItems(menu: Menu): Boolean {
  var hid = false
  for (index in 0 until menu.size()) {
    val item = menu.getItem(index)
    if (item.isVisible && !keptInChatSelectionMenu(item.itemId)) {
      item.isVisible = false
      hid = true
    }
  }
  return hid
}

/**
 * A Text's selection menu with only Copy and Select all showing ([keepOnlyChatSelectionItems]).
 * Everything else is the wrapped menu's: what an item does, where the toolbar sits, what closing it
 * does. A menu that cannot be trimmed is left whole, with one line in the log: the worst this can
 * do is the menu the Text would have shown anyway.
 */
internal class ChatSelectionMenuCallback(private val inner: ActionMode.Callback) : ActionMode.Callback2() {
  override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean {
    val created = inner.onCreateActionMode(mode, menu)
    if (created) {
      trim(menu)
    }
    return created
  }

  override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean {
    val prepared = inner.onPrepareActionMode(mode, menu)
    return trim(menu) || prepared
  }

  override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean = inner.onActionItemClicked(mode, item)

  override fun onDestroyActionMode(mode: ActionMode) {
    inner.onDestroyActionMode(mode)
  }

  // The floating toolbar sits over the selection only if the Text's menu still places it.
  override fun onGetContentRect(mode: ActionMode, view: View, outRect: Rect) {
    val placed = inner as? ActionMode.Callback2
    if (placed != null) {
      placed.onGetContentRect(mode, view, outRect)
    } else {
      super.onGetContentRect(mode, view, outRect)
    }
  }

  private fun trim(menu: Menu): Boolean =
    try {
      keepOnlyChatSelectionItems(menu)
    } catch (error: RuntimeException) {
      Log.w("OrcaSelectionCopy", "Kept a Text's whole selection menu: it could not be trimmed", error)
      false
    }
}
