import {
  findLandedUnconfirmedSends,
  type UnconfirmedSend
} from './mobile-native-chat-draft-reconcile'
import type { MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

/** How long an ack-lost send waits for evidence before the view says the
 *  delivery is unconfirmed. */
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
    ...(origin.knownReceiptNonces ? { knownReceiptNonces: origin.knownReceiptNonces } : {})
  }
  // Why: the transcript event can beat the lost RPC acknowledgement.
  if (isActiveTranscript && findLandedUnconfirmedSends(messages, [entry]).length > 0) {
    return null
  }
  entry.deadline = setTimeout(() => {
    onExpire(entry)
    onUnconfirmed()
  }, UNCONFIRMED_SEND_DEADLINE_MS)
  return entry
}
