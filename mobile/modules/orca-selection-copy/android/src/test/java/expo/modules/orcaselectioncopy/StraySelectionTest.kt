package expo.modules.orcaselectioncopy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The user's recording, 2026-10-15 (0.9.150): after "answered" was held and the chat scrolled, the
 * highlight sat on "pictures" and on a table cell's "used", with no menu, and nothing ever cleared
 * "used". Those were words a hold lit and the scroll then took the touch from, so their menu never
 * opened (StraySelection.kt). The document's root clears such a selection; these pin which ones.
 */
class StraySelectionTest {
  private val used = SelectedRange(12, 16)

  @Test
  fun `clears words a hold lit when no menu opened for them`() {
    assertTrue(isStraySelection(before = null, after = used, hasMenu = false))
  }

  @Test
  fun `keeps a selection whose menu opened`() {
    assertFalse(isStraySelection(before = null, after = used, hasMenu = true))
  }

  @Test
  fun `keeps what the Text already held when the finger went down`() {
    assertFalse(isStraySelection(before = used, after = used, hasMenu = false))
  }

  @Test
  fun `clears words lit in place of an older selection in the same Text`() {
    assertTrue(isStraySelection(before = SelectedRange(0, 8), after = used, hasMenu = false))
  }

  @Test
  fun `has nothing to clear where nothing is selected`() {
    assertFalse(isStraySelection(before = used, after = null, hasMenu = false))
    assertFalse(isStraySelection(before = null, after = null, hasMenu = false))
  }

  @Test
  fun `reads a selection made backwards as the same range`() {
    assertEquals(SelectedRange(12, 16), selectedRangeOf(16, 12, 40))
  }

  @Test
  fun `reads a caret, a missing selection or one past the text as none`() {
    assertNull(selectedRangeOf(5, 5, 40))
    assertNull(selectedRangeOf(-1, -1, 40))
    assertNull(selectedRangeOf(12, 41, 40))
    assertNull(selectedRangeOf(0, 1, 0))
  }

  @Test
  fun `selects the single character of a one-character Text`() {
    assertEquals(SelectedRange(0, 1), selectedRangeOf(0, 1, 1))
  }

  @Test
  fun `a finger within the touch slop is still a hold`() {
    assertFalse(movedPastSlop(100f, 200f, 105f, 203f, 8f))
    assertFalse(movedPastSlop(100f, 200f, 108f, 200f, 8f))
  }

  @Test
  fun `a finger past the touch slop, in any direction, is a drag`() {
    assertTrue(movedPastSlop(100f, 200f, 100f, 209f, 8f))
    assertTrue(movedPastSlop(100f, 200f, 91f, 200f, 8f))
    assertTrue(movedPastSlop(100f, 200f, 106f, 206f, 8f))
  }
}
