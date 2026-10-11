import {
  findLandedUnconfirmedSends,
  normalizeReconcileText,
  type UnconfirmedSend
} from './mobile-native-chat-draft-reconcile'
import { isTakenSend, type MobileNativeChatPendingMessage, type MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'
import { outboxEntryIdOfEcho } from './mobile-native-chat-outbox-drafts'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { findBeaconConfirmedSends, type BeaconPromptReceipt } from './mobile-native-chat-beacon-confirm'
import { appForegroundSince } from './app-foreground-clock'
import { releaseOutboxSend, retireOutboxSend } from './native-chat-outbox-sends'

/** How long an ack-lost send waits for evidence before the view says the
 *  delivery is unconfirmed: time with the app in the foreground (foregroundTimeStillOwed). */
export const UNCONFIRMED_SEND_DEADLINE_MS = 20_000

/**
 * Holds a send whose acknowledgement was lost.
 *
 * A relay drop mid-send usually loses only the ack: the desktop already has the
 * message. Claiming failure there baits a duplicate, so the send is held
 * instead — quiet if the transcript echo lands, and surfaced only if the
 * deadline passes with no evidence. The composer was cleared at send time, so
 * this never touches drafts.
 *
 * Extracted from the drafts hook because that file sits at its max-lines cap and
 * this is the part that keeps growing.
 *
 * Returns the entry it parked, or null when the transcript already proved the
 * send landed and nothing needs holding.
 */
export function parkUnconfirmedSend(args: {
  origin: MobileNativeChatSendOrigin
  text: string
  messages: readonly NativeChatMessage[]
  /** The agent's prompt copies as they are now. One that already carries the send (taken after
   *  it left, by nonce) settles it here: the confirm effect looks only when the copies change, so
   *  a copy that came in before the hold was parked would otherwise never be seen by it. */
  receipts?: readonly BeaconPromptReceipt[]
  /** The chat's bubbles: an earlier send of the same words still waiting for its row takes it
   *  first (landedHeldSends). */
  pending?: readonly MobileNativeChatPendingMessage[]
  /** The transcript on screen is this send's own, so its echo is admissible. */
  isActiveTranscript: boolean
  onUnconfirmed: () => void
  onExpire: (entry: UnconfirmedSend) => void
}): UnconfirmedSend | null {
  const { origin, text, messages, isActiveTranscript, onUnconfirmed, onExpire } = args
  const entry: UnconfirmedSend = {
    draftKey: origin.draftKey,
    pendingKey: origin.pendingKey,
    text,
    normalizedText: origin.normalizedText,
    baselineTailMessageId: origin.baselineTailMessageId,
    deadline: null,
    ...(origin.knownReceiptNonces ? { knownReceiptNonces: origin.knownReceiptNonces } : {}),
    ...(origin.outboxId ? { outboxId: origin.outboxId } : {}),
    ...(origin.sentAt !== undefined ? { sentAt: origin.sentAt } : {})
  }
  // Why: the transcript event can beat the lost RPC acknowledgement, and so can the prompt copy.
  // Both only from this send's own chat: the copies are the active tab's.
  if (
    isActiveTranscript &&
    (landedHeldSends(messages, [entry], args.pending ?? []).length > 0 ||
      findBeaconConfirmedSends(args.receipts ?? [], [entry]).length > 0)
  ) {
    void retireOutboxSend(entry.outboxId)
    return null
  }
  const arm = (delayMs: number): void => {
    const armedAt = Date.now()
    entry.deadline = setTimeout(() => {
      const left = foregroundTimeStillOwed(armedAt)
      if (left > 0) {
        arm(left)
        return
      }
      onExpire(entry)
      // Its time is up with no sign of it. The outbox sees it through: the chat's recovery when
      // its view is on screen with a settled transcript, and the app-wide drainer otherwise, text
      // and photos alike, whichever chat is showing; each looks for it again first and sends it
      // once, safely, or says "Not sent" with Retry. Only an entry the outbox cannot send (no
      // route, written by an older build, or no drainer mounted) says what it always said and
      // leaves the outbox, so nothing announced as unconfirmed is resent behind the user
      // (releaseOutboxSend).
      if (!releaseOutboxSend(entry.outboxId)) {
        void retireOutboxSend(entry.outboxId)
        onUnconfirmed()
      }
    }, delayMs)
  }
  arm(UNCONFIRMED_SEND_DEADLINE_MS)
  return entry
}

/**
 * How much longer a hold armed at `armedAt` waits before it says the delivery is
 * unconfirmed, or 0 when its time is up.
 *
 * The deadline is time the phone could have heard the evidence in: the app in the
 * foreground, its link up, the transcript and the prompt hook flowing. Android runs no
 * JS timer while the app is away, and Date.now() keeps going, so a hold whose deadline
 * came due while the app was away fired the moment it came back, before the link could
 * redial and the transcript catch up, and called a delivered message "Delivery
 * unconfirmed" (2026-10-09). With a headless task running timers it fired while the app
 * was away, where nobody saw it. Either way it now waits the full deadline again from
 * the moment the app came back.
 */
function foregroundTimeStillOwed(armedAt: number): number {
  const back = appForegroundSince()
  if (back === null) {
    return UNCONFIRMED_SEND_DEADLINE_MS
  }
  return back > armedAt ? Math.max(0, back + UNCONFIRMED_SEND_DEADLINE_MS - Date.now()) : 0
}

/** The send id a bubble stands for: its outbox entry's for a phone send drawn under it, else the
 *  bubble's own id (a send from a build before one id per send). */
export function sendIdOfBubble(id: string): string {
  return outboxEntryIdOfEcho(id) ?? id
}

/**
 * The held sends `messages` shows landed, each on a row no other send has (S1).
 *
 * Sends of the same words take rows in the order they left the phone. A bubble still waiting for
 * its row with no hold behind it (a send Claude's own receipt confirmed) is a send too: before
 * this, a later ack-lost "yes" took the row the earlier "yes" was waiting for, left the outbox as
 * delivered, and nothing ever sent it. Witnessed messages and sends the agent took from its queue
 * (owed no row, isTakenSend) do not compete.
 */
export function landedHeldSends(
  messages: readonly NativeChatMessage[],
  held: readonly UnconfirmedSend[],
  pending: readonly MobileNativeChatPendingMessage[]
): UnconfirmedSend[] {
  const heldIds = new Set(held.flatMap((entry) => (entry.outboxId ? [entry.outboxId] : [])))
  const earlier: UnconfirmedSend[] = pending
    .filter(
      (item) =>
        item.id.startsWith('pending-') &&
        !isTakenSend(item) &&
        item.baselineResolved &&
        normalizeReconcileText(item.text) !== '' &&
        !heldIds.has(sendIdOfBubble(item.id))
    )
    .map((item) => ({
      draftKey: '',
      pendingKey: null,
      text: item.text,
      normalizedText: normalizeReconcileText(item.text),
      baselineTailMessageId: item.baselineTailMessageId,
      deadline: null,
      outboxId: sendIdOfBubble(item.id),
      sentAt: item.sentAt ?? 0
    }))
  if (earlier.length === 0) {
    return findLandedUnconfirmedSends(messages, held)
  }
  // A held send first on a tie (the sort is stable): a resend after "unconfirmed" is pressed
  // after it, so the held one is never the later of the two.
  const inSendOrder = [...held, ...earlier].sort((a, b) => (a.sentAt ?? 0) - (b.sentAt ?? 0))
  const landed = new Set(findLandedUnconfirmedSends(messages, inSendOrder))
  return held.filter((entry) => landed.has(entry))
}
