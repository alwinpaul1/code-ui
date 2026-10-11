import {
  findLandedUnconfirmedSends,
  type UnconfirmedSend
} from './mobile-native-chat-draft-reconcile'
import type { MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'
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
    ...(origin.outboxId ? { outboxId: origin.outboxId } : {})
  }
  // Why: the transcript event can beat the lost RPC acknowledgement, and so can the prompt copy.
  // Both only from this send's own chat: the copies are the active tab's.
  if (
    isActiveTranscript &&
    (findLandedUnconfirmedSends(messages, [entry]).length > 0 ||
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
