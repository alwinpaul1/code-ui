/**
 * Spread onto a Text inside selectable markdown that opens something on a
 * tap: a link, a file named in the prose, a file pill. A tap still opens it;
 * a hold does not.
 *
 * Android starts its own text selection on the hold, and React Native still
 * fires the Text's onPress when that finger lifts, unless the Text has an
 * onLongPress to cancel the press (Pressability: a press is cancelled by a
 * long press only when onLongPress is set). So a hold to copy a link opened
 * it the moment the reader let go (second review, 2026-09-25). Text takes no
 * delayLongPress, so the press counts as long at Pressability's 500 ms; a
 * hold released between Android's 400 ms and that still opens.
 */
export const HOLD_DOES_NOT_OPEN = { onLongPress: () => undefined } as const
