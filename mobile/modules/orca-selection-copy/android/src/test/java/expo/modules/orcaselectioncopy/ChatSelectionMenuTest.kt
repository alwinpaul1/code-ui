package expo.modules.orcaselectioncopy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The items a long press on a chat reply offered on the user's phone (2026-10-12): Android's
 * toolbar with an AI sparkle, Copy, Translate, Select all and a ⋮ overflow. The Claude app's pill
 * on the same reply holds Copy and Select all. TextView's Editor adds Copy and Select all under
 * these ids (TextView.ID_COPY, ID_SELECT_ALL); the rest are its assist item (android.R.id.textAssist),
 * Share (android.R.id.shareText), and PROCESS_TEXT actions such as Translate, added with id 0.
 */
class ChatSelectionMenuTest {
  @Test
  fun `keeps only Copy and Select all of a reply's selection menu`() {
    assertTrue(keptInChatSelectionMenu(android.R.id.copy))
    assertTrue(keptInChatSelectionMenu(android.R.id.selectAll))
    assertFalse(keptInChatSelectionMenu(android.R.id.textAssist))
    assertFalse(keptInChatSelectionMenu(android.R.id.shareText))
    assertFalse(keptInChatSelectionMenu(android.R.id.cut))
    assertFalse(keptInChatSelectionMenu(android.R.id.paste))
    assertFalse(keptInChatSelectionMenu(0))
    assertEquals(setOf(android.R.id.copy, android.R.id.selectAll), CHAT_SELECTION_MENU_ITEMS)
  }

  @Test
  fun `reads the accent processColor sent, signed or unsigned`() {
    // #C96442, the light accent, as processColor gives it on Android (signed) and as an unsigned int.
    val clay = 0xFFC96442.toInt()
    assertEquals(clay, colorIntOf(clay.toDouble()))
    assertEquals(clay, colorIntOf(0xFFC96442L.toDouble()))
    // The highlight: the accent at 40% (0x66 alpha).
    assertEquals(0x66C96442, colorIntOf(0x66C96442.toDouble()))
    assertNull(colorIntOf(null))
  }
}
