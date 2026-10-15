package expo.modules.orcaselectioncopy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The user, 2026-10-15: "Sometimes when scrolling the vibration triggers and text is somehow
 * getting selected." Once gesture-handler's scroll takes the touch, the views below hear nothing
 * more of it (no MOVE, no lift, and no ACTION_CANCEL until the next finger down), so the
 * document's root decides from where the document stands in its window, and from the MOVEs it saw
 * before that (ScrollTakesHold.kt).
 */
class ScrollTakesHoldTest {
  private val timeout = 400L

  // The S23 Ultra's density at its default resolution.
  private val s23 = roundingTolerancePx(3.5f)

  @Test
  fun `a finger that stays still on a resting list is still a hold`() {
    assertFalse(scrolledUnderFinger(40, 900, 40, 900, s23))
    assertFalse(dragCancelsHold(elapsedMs = timeout, longPressTimeoutMs = timeout, pastSlop = false))
  }

  @Test
  fun `a pixel of rounding is not a scroll`() {
    assertFalse(scrolledUnderFinger(40, 900, 40, 901, roundingTolerancePx(1f)))
    assertFalse(scrolledUnderFinger(40, 900, 39, 899, roundingTolerancePx(1f)))
  }

  @Test
  fun `a 2 px disagreement of the list's anchor mid-turn is not a scroll at density 3,5`() {
    assertFalse(scrolledUnderFinger(40, 900, 40, 902, s23))
    assertFalse(scrolledUnderFinger(40, 900, 40, 898, s23))
  }

  @Test
  fun `the tolerance is about one dp`() {
    assertEquals(4, s23)
    assertEquals(3, roundingTolerancePx(2.625f))
    assertEquals(1, roundingTolerancePx(1f))
    // A density the system never reports still leaves a pixel for rounding.
    assertEquals(1, roundingTolerancePx(0f))
  }

  @Test
  fun `the list moving the words under the finger is a scroll, either way up`() {
    // The chat list is inverted (scaleY -1): a drag moves its rows the other way in the window.
    assertTrue(scrolledUnderFinger(40, 900, 40, 905, s23))
    assertTrue(scrolledUnderFinger(40, 900, 40, 860, s23))
    assertTrue(scrolledUnderFinger(40, 900, 70, 900, s23))
  }

  @Test
  fun `a scroll before the hold fired is the list taking the touch`() {
    assertFalse(holdHasFired(elapsedMs = 120L, longPressTimeoutMs = timeout, litThisGesture = false))
  }

  @Test
  fun `a scroll after the hold fired leaves the selection alone`() {
    // A plain ScrollView brings the Text it just selected into view (requestChildFocus), which
    // scrolls: that scroll is the hold's own doing, not the list taking the touch.
    assertTrue(holdHasFired(elapsedMs = timeout, longPressTimeoutMs = timeout, litThisGesture = false))
    assertTrue(holdHasFired(elapsedMs = timeout + 250L, longPressTimeoutMs = timeout, litThisGesture = false))
    // Words lit by this gesture before the timeout (a deep press goes off at once) count too.
    assertTrue(holdHasFired(elapsedMs = 30L, longPressTimeoutMs = timeout, litThisGesture = true))
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
