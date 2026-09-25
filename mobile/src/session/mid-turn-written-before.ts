import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'
import { lastRowBefore } from './use-desktop-prompt-echoes'

/**
 * The least slack between the phone's clock and the desktop's.
 *
 * A send's time comes from the phone and a row's from the desktop, so only a
 * row written at least this long before the send is moved above it. The two
 * cases seen were 1.6 s and 8.4 s before the send.
 */
export const PHONE_CLOCK_MARGIN_MS = 1000

/** When each live row reached the phone, by the phone's clock. */
const arrivals = new WeakMap<NativeChatMessage, number>()

/** Record live rows as they arrive (appended frames only: a snapshot's rows
 *  were written long before, and say nothing about the clocks). */
export function noteLiveRowsArrived(rows: readonly NativeChatMessage[], arrivedAt: number): void {
  for (const row of rows) {
    arrivals.set(row, arrivedAt)
  }
}

/**
 * How far the phone's clock may be ahead of the desktop's, from the rows it
 * holds: no row arrives before it was stamped, so the smallest gap between a
 * row's stamp and its arrival bounds the lead. With a phone 3 s ahead, a fixed
 * 1 s margin moved a call written a second after the send above it (review,
 * 2026-09-24); this widens the margin to what the clocks actually allow.
 */
export function phoneClockAllowanceMs(rawMessages: readonly NativeChatMessage[]): number {
  let smallest = Number.POSITIVE_INFINITY
  for (const message of rawMessages) {
    const arrivedAt = arrivals.get(message)
    if (arrivedAt !== undefined && message.timestamp !== null) {
      smallest = Math.min(smallest, arrivedAt - message.timestamp)
    }
  }
  return Number.isFinite(smallest) ? Math.max(PHONE_CLOCK_MARGIN_MS, smallest) : PHONE_CLOCK_MARGIN_MS
}

/**
 * The row a mid-turn message is drawn after: the last row the phone held when
 * the message was sent, or a row written before the send that loaded after it,
 * whichever comes later. Rows written after the send stay below the message.
 *
 * Claude Code can stamp a reply before a send and write it to the transcript
 * after: "Red. Implementing the connecting state:" is stamped 22:15:15.441 and
 * was written after a message the phone sent at 22:15:23.873, so the send's
 * tail was the row above the reply, and the reply drew below the message while
 * the Claude app drew it above (2026-09-24). The hook's desktop prompts already
 * followed such rows (use-desktop-prompt-echoes.ts); the phone's own sends and
 * the queue-box witness did not.
 */
export function drawAfterRowsWrittenBefore(
  rawMessages: readonly NativeChatMessage[],
  anchorId: string | null,
  writtenBefore: number
): string | null {
  const timed = lastRowBefore(rawMessages, writtenBefore)
  if (typeof timed !== 'string' || timed === anchorId) {
    return anchorId
  }
  const timedIndex = rawMessages.findIndex((message) => message.id === timed)
  const anchorIndex = anchorId === null ? -1 : rawMessages.findIndex((message) => message.id === anchorId)
  return timedIndex > anchorIndex ? timed : anchorId
}

/** The phone's own sends, each drawn after the rows written before it. A send
 *  with no recorded time (restored from an older build) stays where it was. */
export function placeOwnSendsAfterRowsWrittenBefore(
  pending: readonly MobileNativeChatPendingMessage[],
  rawMessages: readonly NativeChatMessage[]
): MobileNativeChatPendingMessage[] {
  let changed = false
  const allowance = phoneClockAllowanceMs(rawMessages)
  const placed = pending.map((item) => {
    if (item.sentAt === undefined) {
      return item
    }
    const anchor = item.baselineTailMessageId ?? item.placementAnchorId ?? null
    const drawAfterId = drawAfterRowsWrittenBefore(rawMessages, anchor, item.sentAt - allowance)
    if (drawAfterId === anchor) {
      return item
    }
    changed = true
    return { ...item, drawAfterId }
  })
  return changed ? placed : (pending as MobileNativeChatPendingMessage[])
}
