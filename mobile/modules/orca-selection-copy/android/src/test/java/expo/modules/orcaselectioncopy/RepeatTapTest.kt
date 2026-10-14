package expo.modules.orcaselectioncopy

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The user's phone, 2026-10-14 17:21 (0.9.143): "while" was selected, the transcript was scrolled,
 * and the highlight came back on single other words ("the", "now", "match") in other paragraphs
 * and messages. Those are not the old selection moved. They are new word selections: a selectable
 * TextView selects the word under a finger on the second touch of a double tap, at ACTION_DOWN
 * (Editor.SelectionModifierCursorController.onTouchEvent: isMultiTapInSameArea + isDoubleTap ->
 * selectCurrentWordAndStartDrag, Editor.java:7012-7021 in android-36.1). A reader who taps to stop
 * a fling and puts the finger straight back down to scroll on makes exactly that double tap, and
 * long-click being off during a scroll (322de5022) does not stop it, because it is not a long
 * press. The Claude app selects on a hold only. So the chat's root takes such a second touch away
 * from its Texts; the scroll view still gets it.
 */
class RepeatTapTest {
  private val timeout = 300L
  private val slop = 100f

  @Test
  fun `takes a second touch soon after a tap, in the same place`() {
    assertTrue(isRepeatTap(1_000L, 200f, 400f, 1_150L, 210f, 420f, timeout, slop))
  }

  @Test
  fun `leaves a touch that comes after the double-tap timeout`() {
    assertFalse(isRepeatTap(1_000L, 200f, 400f, 1_000L + timeout + 1, 200f, 400f, timeout, slop))
  }

  @Test
  fun `leaves a touch somewhere else`() {
    assertFalse(isRepeatTap(1_000L, 200f, 400f, 1_100L, 200f, 400f + slop + 1, timeout, slop))
  }

  @Test
  fun `leaves the first touch there is`() {
    assertFalse(isRepeatTap(null, 0f, 0f, 1_100L, 0f, 0f, timeout, slop))
  }

  @Test
  fun `treats a clock that went backwards as no repeat`() {
    assertFalse(isRepeatTap(2_000L, 200f, 400f, 1_000L, 200f, 400f, timeout, slop))
  }
}
