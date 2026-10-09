/** Where one scroll sample left the list: the offset and the content height
 *  the event reported, both in dp. */
export type ChatScrollGeometry = { offset: number; height: number }

/** How far a place-holding correction may miss the growth it answers. Both
 *  numbers are rounded to device pixels on their own way to the event
 *  (FlashList's anchor and the content container), so they can differ by a
 *  pixel or two, which is under 1 dp at 2x and 3x. A fling step that small
 *  is the last frame of a fling. */
const ANCHOR_SLOP_DP = 1

/**
 * Whether a scroll sample is the list MOVING under the reader, as opposed to
 * the list holding their place while the content changes.
 *
 * While the reader is off the live edge, FlashList keeps what they read still
 * (`maintainVisibleContentPosition`): when rows above them grow, it scrolls
 * by exactly that growth, and the scroll view reports it like any other
 * scroll. A streaming reply grows as often as the controller's stream
 * throttle lets it (`NATIVE_CHAT_STREAM_THROTTLE_MS`, 50 ms), so those
 * corrections arrive all turn long, and counting them as movement kept chat
 * text unselectable for as long as the agent wrote (2026-09-25, phone
 * recording: a hold on a paragraph and a bullet mid-turn selected nothing).
 *
 * A correction moves the offset by what the content height moved. A drag or
 * a fling moves the offset with no change in height, or by more than it.
 * With nothing to compare against, or a number that is not one, count it as
 * movement: that errs toward the 2026-09-12 rule, never away from it.
 */
export function isReaderScrollMotion(
  previous: ChatScrollGeometry | null,
  next: ChatScrollGeometry
): boolean {
  if (previous === null) {
    return true
  }
  const moved = next.offset - previous.offset
  const grew = next.height - previous.height
  if (!Number.isFinite(moved) || !Number.isFinite(grew)) {
    return true
  }
  if (moved === 0) {
    return false
  }
  return grew === 0 || Math.abs(moved - grew) > ANCHOR_SLOP_DP
}
