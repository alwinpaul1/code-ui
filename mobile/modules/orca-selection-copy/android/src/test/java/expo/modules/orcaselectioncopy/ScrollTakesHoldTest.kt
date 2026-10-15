package expo.modules.orcaselectioncopy

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The user, 2026-10-15: "Sometimes when scrolling the vibration triggers and text is somehow
 * getting selected." Once gesture-handler's scroll takes the touch, the Texts below hear nothing
 * more (no MOVE, no CANCEL), so the document's root decides from where the document stands in its
 * window, and from the MOVEs it saw before that (ScrollTakesHold.kt).
 */
class ScrollTakesHoldTest {
  private val timeout = 400L

  @Test
  fun `a finger that stays still on a resting list is still a hold`() {
    assertFalse(scrolledUnderFinger(40, 900, 40, 900))
    assertFalse(dragCancelsHold(elapsedMs = timeout, longPressTimeoutMs = timeout, pastSlop = false))
  }

  @Test
  fun `a pixel of rounding is not a scroll`() {
    assertFalse(scrolledUnderFinger(40, 900, 40, 901))
    assertFalse(scrolledUnderFinger(40, 900, 39, 899))
  }

  @Test
  fun `the list moving the words under the finger is a scroll, either way up`() {
    // The chat list is inverted (scaleY -1): a drag moves its rows the other way in the window.
    assertTrue(scrolledUnderFinger(40, 900, 40, 902))
    assertTrue(scrolledUnderFinger(40, 900, 40, 860))
    assertTrue(scrolledUnderFinger(40, 900, 70, 900))
  }

  @Test
  fun `a drag past the slop before the long-press timeout cancels the hold`() {
    assertTrue(dragCancelsHold(elapsedMs = 120L, longPressTimeoutMs = timeout, pastSlop = true))
  }

  @Test
  fun `a drag that reaches the slop exactly at the long-press timeout cancels the hold`() {
    assertTrue(dragCancelsHold(elapsedMs = timeout, longPressTimeoutMs = timeout, pastSlop = true))
  }

  @Test
  fun `a finger that moves after the hold completed leaves the hold to the Text`() {
    // The word is lit by then; dragging it extends the selection, as Android does.
    assertFalse(dragCancelsHold(elapsedMs = timeout + 1, longPressTimeoutMs = timeout, pastSlop = true))
  }

  @Test
  fun `a finger inside the slop at the very first move is still a hold`() {
    assertFalse(dragCancelsHold(elapsedMs = 0L, longPressTimeoutMs = timeout, pastSlop = false))
  }
}
