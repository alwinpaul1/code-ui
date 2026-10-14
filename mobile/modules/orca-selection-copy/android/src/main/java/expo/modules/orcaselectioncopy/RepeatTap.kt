package expo.modules.orcaselectioncopy

/**
 * Whether a touch going down at [downAt] ([x], [y]) is the second touch of a double tap: within
 * [timeoutMs] of the last lift ([lastUpAt], [upX], [upY]) and within [slop] pixels of it. A
 * TextView selects the word under such a touch (Editor's SelectionModifierCursorController), and
 * the chat's root keeps it from its Texts (SelectionCopyRootView.onInterceptTouchEvent).
 */
internal fun isRepeatTap(
  lastUpAt: Long?,
  upX: Float,
  upY: Float,
  downAt: Long,
  x: Float,
  y: Float,
  timeoutMs: Long,
  slop: Float
): Boolean {
  lastUpAt ?: return false
  val elapsed = downAt - lastUpAt
  if (elapsed < 0 || elapsed > timeoutMs) {
    return false
  }
  val dx = x - upX
  val dy = y - upY
  return dx * dx + dy * dy <= slop * slop
}
