import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { claimRowForSend, rowClaimedByAnother, sendHasRow } from '../storage/native-chat-send-claims'
import { normalizeReconcileText, normalizedUserText } from './mobile-native-chat-draft-reconcile'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'
import { sendIdOfBubble } from './mobile-native-chat-unconfirmed-hold'

/**
 * Writes down, under each send's one id, the transcript row that just retired its bubble (S1).
 *
 * A bubble retires by counting its words in the transcript, which names no row. The outbox and
 * the holds look for a row after a send's boundary, so without this the row that retired the
 * first "yes" was free to prove a second "yes" delivered too: on a later look in this run, or
 * after a restart (the outbox entry of a send the app was closed under). The row taken is the
 * first of its words after the bubble's boundary that no other send has.
 *
 * Only the phone's own sends (`pending-…`), with words, against a boundary this read holds. A
 * photo with no caption, a witnessed message, a glued row (several sends in one, whose text is
 * none of theirs) and a boundary the read no longer reaches claim nothing: the count is what it
 * always was there.
 */
export function claimRowsOfRetiredOwnSends(
  messages: readonly NativeChatMessage[],
  before: readonly MobileNativeChatPendingMessage[],
  after: readonly MobileNativeChatPendingMessage[]
): void {
  if (before.length === 0 || before === after) {
    return
  }
  const kept = new Set(after.map((item) => item.id))
  const retired = before
    .filter((item) => !kept.has(item.id) && item.id.startsWith('pending-') && item.baselineResolved)
    .sort((a, b) => (a.sentAt ?? 0) - (b.sentAt ?? 0))
  if (retired.length === 0) {
    return
  }
  const indexById = new Map(messages.map((message, index) => [message.id, index]))
  for (const item of retired) {
    const key = normalizeReconcileText(item.text)
    const tail = item.baselineTailMessageId === null ? -1 : indexById.get(item.baselineTailMessageId)
    if (key === '' || tail === undefined) {
      continue
    }
    const sendId = sendIdOfBubble(item.id)
    if (sendHasRow(sendId)) {
      continue // a hold or the outbox already settled it on its row
    }
    const row = messages.find(
      (message, index) => index > tail && normalizedUserText(message) === key && !rowClaimedByAnother(message.id, sendId)
    )
    if (row) {
      claimRowForSend(sendId, row.id)
    }
  }
}
