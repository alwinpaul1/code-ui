import type { Dispatch, SetStateAction } from 'react'
import type { NativeChatOutboxEntry } from '../storage/native-chat-outbox'
export type { NativeChatOutboxEntry }
import type { MobileNativeChatPendingMessage, MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'
import { acceptOwnSendInPending } from './mobile-native-chat-remember-echo'
import { findOutboxEntry, newOutboxSendId, patchOutboxEntry, retireOutboxSend, takeOutboxAdoption } from './native-chat-outbox-sends'

type PendingByKey = Record<string, MobileNativeChatPendingMessage[]>

/** The bubble a recovered outbox entry is drawn as; its id names the entry. */
export const OUTBOX_ECHO_PREFIX = 'pending-outbox-'

export function outboxEchoId(entryId: string): string {
  return `${OUTBOX_ECHO_PREFIX}${entryId}`
}

/** The entry id an outbox bubble stands for, or null for any other row. */
export function outboxEntryIdOfEcho(rowId: string): string | null {
  return rowId.startsWith(OUTBOX_ECHO_PREFIX) ? rowId.slice(OUTBOX_ECHO_PREFIX.length) : null
}

/** What captureSendOrigin adds to an origin: the entry it adopts, or a new one. */
export function originOutboxFields(
  draftKey: string,
  normalizedText: string
): Pick<MobileNativeChatSendOrigin, 'outboxId' | 'outboxRecovery'> {
  const adopted = takeOutboxAdoption(draftKey, normalizedText)
  if (!adopted) {
    return { outboxId: newOutboxSendId() }
  }
  return adopted.recovery ? { outboxId: adopted.id, outboxRecovery: true } : { outboxId: adopted.id }
}

/**
 * A definite refusal. A first attempt's words go back into the composer, as they always did, and
 * its entry leaves the outbox (it is in the box now). A recovery resend's do not: the user is not
 * looking at a box they emptied minutes or a restart ago, so its bubble says "Not sent" and offers
 * Retry. Returns true when the words must stay out of the composer.
 */
export function keepRefusedSendInOutbox(origin: MobileNativeChatSendOrigin): boolean {
  if (origin.outboxRecovery && origin.outboxId) {
    void patchOutboxEntry(origin.outboxId, { failed: true })
    return true
  }
  void retireOutboxSend(origin.outboxId)
  return false
}

/**
 * Draws a text send's bubble the moment its box empties, as a plain sent message with no label
 * (MobileNativeChatOutboxStatus.tsx draws nothing while it is on its way). Until 2026-10-10 the
 * bubble waited for the whole send: the clear, the body, its Enter and Claude's check that it took
 * the words, a couple of seconds over the relay with an empty box and nothing in the chat ("it
 * leaves the input and takes time to land"). Only
 * for a send the outbox holds and a chat with a session; the origin is marked so acceptance keeps
 * this bubble and a refusal takes it down.
 */
export function showSendingEchoWith(
  origin: MobileNativeChatSendOrigin,
  showEcho: (entry: NativeChatOutboxEntry) => void
): void {
  const entry = findOutboxEntry(origin.outboxId)
  if (entry && origin.pendingKey && !origin.outboxRecovery) {
    origin.echoDrawn = true
    showEcho(entry)
  }
}

/** Draws a recovered entry's bubble, once: the same id is never drawn twice. */
export function showOutboxEchoIn(
  entry: NativeChatOutboxEntry,
  setPendingBySession: Dispatch<SetStateAction<PendingByKey>>,
  setPendingWaitingForSession: Dispatch<SetStateAction<PendingByKey>>
): void {
  const id = outboxEchoId(entry.id)
  const origin: MobileNativeChatSendOrigin = {
    draftKey: entry.draftKey,
    draftEditGeneration: 0,
    pendingKey: entry.pendingKey,
    normalizedText: entry.normalizedText,
    baselineOccurrences: entry.baselineOccurrences,
    baselineTailMessageId: entry.baselineTailMessageId,
    baselineResolved: entry.baselineResolved,
    sentAt: entry.createdAt,
    ...(entry.markersBefore !== undefined ? { markersBefore: entry.markersBefore } : {})
  }
  const key = entry.pendingKey ?? entry.draftKey
  const set = entry.pendingKey ? setPendingBySession : setPendingWaitingForSession
  set((previous) =>
    (previous[key] ?? []).some((item) => item.id === id)
      ? previous
      : acceptOwnSendInPending(previous, key, id, origin, entry.text.trimEnd())
  )
}
