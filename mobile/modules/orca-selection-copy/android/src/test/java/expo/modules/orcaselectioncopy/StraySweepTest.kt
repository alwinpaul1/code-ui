package expo.modules.orcaselectioncopy

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Review of 1245b7fdd: every lift armed a sweep 2.5 s later that belonged to no gesture. A reader
 * who tapped to stop a fling and then, 1.6 to 2.0 s later, held a word saw the long press light it
 * at 2.1 to 2.5 s, and the earlier tap's sweep then found lit words with no menu (the menu opens
 * only at the lift) and cleared them under the finger: the hold gave nothing. A sweep now runs only
 * in the gesture that armed it, and only once its finger is up ([GestureClock]).
 *
 * A selection put back by restoreHeld or reselect has no menu until its action mode opens, so a
 * sweep landing in between must take it for live, not a stray ([AwaitingMenu]).
 */
class StraySweepTest {
  @Test
  fun `a tap's sweep never clears a word held after it`() {
    val clock = GestureClock()
    clock.down()
    clock.ended()
    val armed = clock.gesture
    // 1.8 s later the reader presses a word and keeps holding.
    clock.down()
    assertFalse(clock.stillDue(armed))
    // And not after that hold lifts either: the hold arms its own sweep.
    clock.ended()
    assertFalse(clock.stillDue(armed))
  }

  @Test
  fun `a sweep runs once its own gesture has lifted and no other has started`() {
    val clock = GestureClock()
    clock.down()
    clock.ended()
    assertTrue(clock.stillDue(clock.gesture))
  }

  @Test
  fun `no sweep runs while a finger is down`() {
    val clock = GestureClock()
    clock.down()
    assertFalse(clock.stillDue(clock.gesture))
  }

  @Test
  fun `the first gesture's sweep is due once it lifts`() {
    val clock = GestureClock()
    val armed = clock.down()
    clock.ended()
    assertTrue(clock.stillDue(armed))
  }

  @Test
  fun `a restored selection waiting for its menu is live`() {
    val awaiting = AwaitingMenu<String>()
    awaiting.restored("cell", SelectedRange(4, 9))
    assertTrue(awaiting.isAwaiting("cell", SelectedRange(4, 9)))
  }

  @Test
  fun `other words lit in that Text later are not taken for the restored ones`() {
    val awaiting = AwaitingMenu<String>()
    awaiting.restored("cell", SelectedRange(4, 9))
    assertFalse(awaiting.isAwaiting("cell", SelectedRange(0, 3)))
    // The mismatch forgot the restore: the same range lit later by a stray hold is a stray.
    assertFalse(awaiting.isAwaiting("cell", SelectedRange(4, 9)))
  }

  @Test
  fun `a restore stops waiting when its menu opens or its Text goes`() {
    val awaiting = AwaitingMenu<String>()
    awaiting.restored("cell", SelectedRange(4, 9))
    awaiting.forget("cell")
    assertFalse(awaiting.isAwaiting("cell", SelectedRange(4, 9)))
  }

  @Test
  fun `nothing selected is never awaiting, and an unknown Text never is`() {
    val awaiting = AwaitingMenu<String>()
    awaiting.restored("cell", SelectedRange(4, 9))
    assertFalse(awaiting.isAwaiting("cell", null))
    assertFalse(awaiting.isAwaiting("other", SelectedRange(4, 9)))
  }

  @Test
  fun `a one-character restore is still awaiting`() {
    val awaiting = AwaitingMenu<String>()
    awaiting.restored("cell", SelectedRange(0, 1))
    assertTrue(awaiting.isAwaiting("cell", SelectedRange(0, 1)))
  }
}
