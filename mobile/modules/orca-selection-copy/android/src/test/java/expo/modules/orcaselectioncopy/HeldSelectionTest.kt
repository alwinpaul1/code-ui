package expo.modules.orcaselectioncopy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The user, 2026-10-14: a selection must stay on its words while a streaming reply grows under it,
 * and come back on its words when its row is drawn again; it must never land on other words. A
 * TextView given new text (a stream tick, a row drawn again) has lost its selection, so the root
 * puts it back only where the words it held still stand at the same place.
 */
class HeldSelectionTest {
  private val reply = "Yes, all of it. The mapping exists: your Mac's transcript has a line."
  private val start = reply.indexOf("The mapping")
  private val end = start + "The mapping exists".length
  private val words = "The mapping exists"

  @Test
  fun `keeps a selection while the reply only grows after it`() {
    assertTrue(selectionStillHolds(words, start, end, reply))
    assertTrue(selectionStillHolds(words, start, end, "$reply And it grows."))
  }

  @Test
  fun `keeps it when words after the selection change`() {
    assertTrue(selectionStillHolds(words, start, end, reply.replace("a line", "two lines")))
  }

  @Test
  fun `drops it when a word inside the selection changes`() {
    assertFalse(selectionStillHolds(words, start, end, reply.replace("mapping", "matching")))
  }

  @Test
  fun `drops it when text before it shifts the words along`() {
    assertFalse(selectionStillHolds(words, start, end, "Well. $reply"))
  }

  @Test
  fun `drops it when the text is now shorter than the selection, or empty`() {
    assertFalse(selectionStillHolds(words, start, end, reply.substring(0, end - 1)))
    assertFalse(selectionStillHolds(words, start, end, ""))
  }

  @Test
  fun `refuses a range that is not a selection`() {
    assertFalse(selectionStillHolds("", 3, 3, reply))
    assertFalse(selectionStillHolds(words, end, start, reply))
    assertFalse(selectionStillHolds(words, -1, end, reply))
  }

  @Test
  fun `reads a restore the JavaScript sent, and nothing malformed`() {
    val held = heldSelectionOf(mapOf("run" to 1.0, "start" to start.toDouble(), "end" to end.toDouble(), "words" to words))
    assertEquals(HeldSelection(1, start, end, words), held)
    assertNull(heldSelectionOf(null))
    assertNull(heldSelectionOf(mapOf("run" to 1.0, "start" to 2.0)))
    assertNull(heldSelectionOf(mapOf("run" to 1.0, "start" to 5.0, "end" to 2.0, "words" to "x")))
  }
}
