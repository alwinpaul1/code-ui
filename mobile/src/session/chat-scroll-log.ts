/**
 * One logcat line per scroll EVENT of the chat transcript (never per sample): a finger down and
 * up, a drag's start and end, a fling's start and end, a pin to the newest message that moved
 * the list, and every hand-over between following and the reader.
 *
 * The user reported the transcript "sometimes getting stuck" while Claude worked (2026-10-17),
 * and nothing in the log said what the list was doing at that moment: the native touches were
 * there, the list's own decisions were not. A touch that ends with no drag, or a pin that lands
 * between a drag's start and its end, is now one line each.
 */
export function logChatScroll(event: string): void {
  console.info(`[chat-scroll] ${event}`)
}

/** The offset, whole dp, as the lines print it. */
export function scrollOffsetLabel(y: number): string {
  return `y=${Math.round(y)}`
}
