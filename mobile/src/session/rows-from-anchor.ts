import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

/**
 * For the row a message from the agent's queue box arrived after (the last
 * row when the box first listed it), which landed user rows can be the
 * message's own: that row and the ones after it. A row before it was written
 * before the message was sent. Claude Code writes no row for a message it
 * takes mid-turn, so a row of the same words from an earlier turn is another
 * message.
 *
 * One rule for both of the queue box's witnesses, so they cannot drift: the
 * echo of a message the agent took is retired by a row from here on
 * (use-absorbed-queue-echoes.ts), and a message still in the box is
 * remembered unless one has landed (queuedDeskWitnesses in
 * use-queued-desk-witnesses.ts). Counted from anywhere, a mid-turn "keep
 * going" after an earlier turn of those words was drawn nowhere once the box
 * let it go, and never remembered while the box listed it (2026-09-30).
 *
 * The anchor row itself counts. A box read can be behind the transcript: the
 * chat opened as Claude dequeued a message at a turn's end, its first read
 * still listed the message, and the row Claude dequeued it as was already
 * the last row (mobile-chat-midturn-queue-box.test.ts). What that costs: the
 * same words sent twice with no row written between, the second taken
 * mid-turn, read as one message. The words cannot tell those apart.
 *
 * An anchor the record no longer holds was paged out above the loaded
 * window, so every row held is after it; a landed row the record does not
 * hold counts, as every row did before this rule. The record is indexed on
 * the first call, so a render that asks nothing does not walk it.
 */
export function rowsFromAnchor(
  rawMessages: readonly NativeChatMessage[],
  rows: readonly NativeChatMessage[]
): (anchorId: string | null) => boolean[] {
  let position: Map<string, number> | null = null
  return (anchorId) => {
    position ??= new Map(rawMessages.map((message, index) => [message.id, index]))
    const at = position
    const anchor = anchorId === null ? undefined : at.get(anchorId)
    return rows.map((row) => anchor === undefined || (at.get(row.id) ?? Infinity) >= anchor)
  }
}
