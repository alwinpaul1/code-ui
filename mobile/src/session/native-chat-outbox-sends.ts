import {
  changeNativeChatOutbox,
  nativeChatOutboxEntries,
  type NativeChatOutboxEntry
} from '../storage/native-chat-outbox'
import type { MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'
import { structuredSessionOperationId, structuredSessionRandomUuid } from './structured-session-operation-id'
import { noteSendStage } from './native-chat-send-timing'

/**
 * When a composer send is written to the outbox and when it leaves it.
 *
 * Written at the moment the composer empties for it (`recordOutboxSend`, beside each
 * `clearDraftForSend` of a real send), and retired once the send's fate is known in this
 * process: accepted by the desktop, its words put back in the composer, or its transcript row
 * seen. An entry whose send is still running here is LIVE and nobody else touches it. One whose
 * process died, or whose send ended without knowing (an unconfirmed hold that ran out), is left
 * for the chat's recovery (use-native-chat-outbox-recovery.ts), which sends it again once, safely,
 * or puts it back in the composer.
 *
 * Every send of a press shares one entry: a photo send's start writes it, and the text send the
 * same press makes afterwards adopts it (`offerOutboxAdoption`); a recovery resend adopts the
 * entry it is resending. A new press is a new entry, with a new id.
 */

/** Entries a send in this process is still carrying. Module state: a send outlives its screen. */
const live = new Set<string>()
/** Chats whose recovery is mounted now, by draft key (counted: two screens can show one tab). */
const recoveries = new Map<string, number>()
type Adoption = { id: string; normalizedText: string; recovery: boolean }
const adoptions = new Map<string, Adoption>()

export function newOutboxSendId(): string {
  return `send-${Date.now()}-${structuredSessionRandomUuid().slice(0, 12)}`
}

/** The next origin captured for these words in this scope takes this entry, once. */
export function offerOutboxAdoption(draftKey: string, normalizedText: string, id: string, recovery: boolean): void {
  adoptions.set(draftKey, { id, normalizedText, recovery })
}

/** Called by captureSendOrigin: the entry an origin for these words belongs to, if one was offered. */
export function takeOutboxAdoption(draftKey: string, normalizedText: string): Adoption | null {
  const offered = adoptions.get(draftKey)
  if (!offered) {
    return null
  }
  adoptions.delete(draftKey)
  return offered.normalizedText === normalizedText ? offered : null
}

export function findOutboxEntry(id: string | undefined): NativeChatOutboxEntry | undefined {
  return id === undefined ? undefined : nativeChatOutboxEntries().find((entry) => entry.id === id)
}

/**
 * Writes the send down before its composer empties. Returns at once; the write runs behind it.
 * Fail-open: a store that refuses leaves the send exactly as it was before the outbox existed.
 * An origin with no outbox id (a test's hand-made one, a command) is not written.
 */
export function recordOutboxSend(
  origin: MobileNativeChatSendOrigin,
  text: string,
  extra?: { hasAttachments?: boolean }
): void {
  const id = origin.outboxId
  if (!id) {
    return
  }
  live.add(id)
  if (findOutboxEntry(id)) {
    return
  }
  const entry: NativeChatOutboxEntry = {
    id,
    draftKey: origin.draftKey,
    pendingKey: origin.pendingKey,
    text,
    normalizedText: origin.normalizedText,
    baselineOccurrences: origin.baselineOccurrences,
    baselineTailMessageId: origin.baselineTailMessageId,
    baselineResolved: origin.baselineResolved,
    createdAt: origin.sentAt ?? Date.now(),
    ...(origin.markersBefore !== undefined ? { markersBefore: origin.markersBefore } : {}),
    ...(origin.knownReceiptNonces ? { knownReceiptNonces: [...origin.knownReceiptNonces] } : {}),
    operationId: structuredSessionOperationId(),
    ...(extra?.hasAttachments ? { hasAttachments: true as const } : {}),
    autoAttempts: 0
  }
  const startedAt = Date.now()
  void changeNativeChatOutbox((current) => [...current, entry]).then(() => noteSendStage('outbox', Date.now() - startedAt))
}

/** The structured operation id every attempt of this origin's entry sends, if it has one. */
export function outboxOperationId(origin: MobileNativeChatSendOrigin): string | undefined {
  return findOutboxEntry(origin.outboxId)?.operationId
}

/** A photo send drew its bubble at the start: kept so the words going back can take it down. */
export function noteOutboxEcho(origin: MobileNativeChatSendOrigin, echoId: string): void {
  const id = origin.outboxId
  if (id) {
    void changeNativeChatOutbox((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, echoId } : entry))
    )
  }
}

/** Its fate is known: delivered, its words back in the composer, or its row seen. */
export function retireOutboxSend(id: string | undefined): Promise<boolean> {
  if (!id) {
    return Promise.resolve(true)
  }
  live.delete(id)
  return changeNativeChatOutbox((current) =>
    current.some((entry) => entry.id === id) ? current.filter((entry) => entry.id !== id) : (current as NativeChatOutboxEntry[])
  )
}

/** Merges `patch` into the entry; resolves whether it reached the disk. */
export function patchOutboxEntry(id: string, patch: Partial<NativeChatOutboxEntry>): Promise<boolean> {
  return changeNativeChatOutbox((current) =>
    current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry))
  )
}

export function isOutboxSendLive(id: string): boolean {
  return live.has(id)
}

/**
 * The send in this process has stopped carrying the entry without knowing its fate. Returns
 * whether a chat's recovery is mounted for its scope now to take it over; when none is, the
 * caller says what it always said, and the entry waits for the next chat that shows its tab.
 */
export function releaseOutboxSend(id: string | undefined): boolean {
  if (!id) {
    return false
  }
  live.delete(id)
  const entry = findOutboxEntry(id)
  return entry !== undefined && (recoveries.get(entry.draftKey) ?? 0) > 0
}

export function registerOutboxRecovery(draftKey: string): () => void {
  recoveries.set(draftKey, (recoveries.get(draftKey) ?? 0) + 1)
  return () => {
    const left = (recoveries.get(draftKey) ?? 1) - 1
    if (left > 0) {
      recoveries.set(draftKey, left)
    } else {
      recoveries.delete(draftKey)
    }
  }
}

/** Test-only: module state outlives a single test; this is a process restart. */
export function resetOutboxSendsForTests(): void {
  live.clear()
  recoveries.clear()
  adoptions.clear()
}
