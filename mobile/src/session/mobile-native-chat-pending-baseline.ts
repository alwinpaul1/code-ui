import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { normalizeReconcileText } from './mobile-native-chat-draft-reconcile'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'
import { SEND_ROW_ORDER_SLACK_MS } from './mobile-native-chat-photo-rows'

/**
 * Give the sends that never saw a transcript the boundary they lack, on the
 * first settled read.
 *
 * Such a send has no row to judge candidates against — which held it out of
 * matching entirely, stranding it as a queued bubble and, worse, as a permanent
 * glue barrier for its neighbours.
 *
 * Only a send that captured NO tail is pinned. An unsettled read still shows
 * this session's own retained history (see `createNativeChatTranscriptRetention`
 * — a reconnect or a failed read keeps the conversation on screen rather than
 * blanking it), so a send made then already owns a correct boundary. Moving it
 * onto this read would push it past the send's own echo and strand the bubble
 * for good.
 *
 * The ordinal is deliberately NOT recounted. The read can already carry the
 * send's own echo — a re-subscribe returns whatever exists now — and nothing
 * local separates that echo from an identical older prompt: the transport writes
 * keystrokes into a TUI and carries no message id, and row timestamps come from
 * the host while the send time comes from the phone. Counting it as history puts
 * the ordinal one past anything the transcript can supply.
 *
 * And only a TEXT-bearing send is given one. The glue matcher is the sole
 * consumer that a supplied tail helps; every other one is harmed by it. An image
 * echo reconciles by counting turns AFTER its tail, so a tail taken from a read
 * that already carries its echo excludes that echo and the bubble can never
 * retire — image entries have no other retirement path. A captioned one is worse
 * still: it binds by an ordinal counted over the whole transcript, so a tail
 * without a matching recount leaves it claiming nothing at all.
 *
 * Every echo does get a PLACEMENT anchor, though — including the ones held back
 * above. Withholding the reconcile boundary was never meant to decide where the
 * bubble is DRAWN, but that is what it did: with no row to sit after, the view
 * dropped it at the tail and kept it there, so a photo sent while the transcript
 * was still loading re-read below every reply that answered it, and a second one
 * stacked under the first (2026-09-15). The placement anchor is where the send
 * happened; no reconciler reads it.
 *
 * Where the send happened is judged by its own send time, not this read's
 * tail. The two agree when the read settles a moment after the send, which is
 * the case all of the above was written for. They do not when it settles
 * later: a message sent from a chat whose read was still in flight, mid-turn,
 * was drawn under the reply that ended the turn, as the last row of the chat,
 * and since Claude writes no row for a message it takes mid-turn, it stayed
 * there (reported 2026-09-25, Claude Code 2.1.282). So the boundary is the
 * row before the first one stamped after the send: every row the tail rule
 * put above the bubble stays above it but those. No clock margin: the old rule
 * put every row above, and a margin moved a row written in the second before
 * the send below it (review, 2026-09-25). A row with no time goes with the
 * rows before it. A send with no time keeps the tail as before.
 */
/**
 * The last row of a read the desk wrote before a send, by the desk's clock
 * alone: a row older than the read's newest by more than the time since the
 * send, read at the moment the read settles, when that time is short. Null
 * when none is, or the send has no time. One clock against itself, so a phone
 * running behind or ahead cannot move it (seventh review of the photo binder,
 * 2026-09-26).
 */
function writtenBeforeSend(messages: readonly NativeChatMessage[], sentAt: number | undefined): string | null {
  if (typeof sentAt !== 'number' || !Number.isFinite(sentAt)) {
    return null
  }
  const newest = messages.reduce<number | null>(
    (latest, message) => (message.timestamp !== null && (latest === null || message.timestamp > latest) ? message.timestamp : latest),
    null
  )
  const sinceSend = Date.now() - sentAt
  let before: string | null = null
  for (const message of messages) {
    if (newest !== null && message.timestamp !== null && newest - message.timestamp > sinceSend + SEND_ROW_ORDER_SLACK_MS) {
      before = message.id
    }
  }
  return before
}

export function rebaseMobileNativeChatPendingBaselines(
  messages: readonly NativeChatMessage[],
  current: MobileNativeChatPendingMessage[]
): MobileNativeChatPendingMessage[] {
  if (current.every((item) => item.baselineResolved)) {
    return current
  }
  const tail = messages.at(-1)?.id ?? null
  const sentAfter = (item: MobileNativeChatPendingMessage): string | null => {
    const sentAt = item.sentAt
    if (typeof sentAt !== 'number' || !Number.isFinite(sentAt)) {
      return tail
    }
    const firstLater = messages.findIndex(
      (message) => message.timestamp !== null && message.timestamp > sentAt
    )
    if (firstLater === -1) {
      return tail
    }
    return firstLater === 0 ? null : messages[firstLater - 1]!.id
  }
  return current.map((item) => {
    if (item.baselineResolved) {
      return item
    }
    // A photo send remembers the read it settled on: a row after it arrived
    // after the send, and a row that read held can be its own only past the
    // last one the desk's own clock says was written before it
    // (mobile-native-chat-draft-reconcile.ts).
    const resolved = {
      ...item,
      baselineResolved: true,
      ...(item.images?.length ? { settledTailId: tail, settledWrittenBeforeId: writtenBeforeSend(messages, item.sentAt) } : {})
    }
    // A send that captured its own tail is already drawn after it.
    if (item.baselineTailMessageId !== null) {
      return resolved
    }
    const reconcilesAgainstItsOwnTail =
      Boolean(item.images?.length) || normalizeReconcileText(item.text) === ''
    // Every row this read holds written after the send gives null, as an
    // empty read does: the send came before all of them, so it leads.
    const sentAfterId = sentAfter(item)
    if (!reconcilesAgainstItsOwnTail) {
      return { ...resolved, baselineTailMessageId: sentAfterId }
    }
    // The boundary stays withheld, for the reasons above — but the bubble still
    // has to be drawn somewhere, and an echo with no row to sit after is drawn
    // at the tail and kept there. This anchor says where; no reconciler reads
    // it. A read that is itself empty gives none, which is the truth: the
    // conversation really was empty when this was sent, so it leads.
    return sentAfterId === null ? resolved : { ...resolved, placementAnchorId: sentAfterId }
  })
}
