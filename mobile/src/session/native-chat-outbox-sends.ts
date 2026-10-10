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
/** Chats whose recovery is mounted with the chat view on screen, by draft key (counted: two
 *  screens can show one tab), and those of them whose transcript is a settled read. */
const recoveries = new Map<string, number>()
const settledRecoveries = new Map<string, number>()
/** Outbox recoveries mounted anywhere in this process, chat view shown or not: whether anything
 *  is there to see a waiting entry through when its tab is next shown. */
let mountedRecoveries = 0
type Adoption = { id: string; normalizedText: string; recovery: boolean }
const adoptions = new Map<string, Adoption>()
/** Entries whose send stopped in this process without knowing its fate (releaseOutboxSend). */
const releasedThisRun = new Set<string>()

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
 * The send in this process has stopped carrying the entry without knowing its fate: an
 * unconfirmed hold ran out, or its chat closed under it. Returns whether the outbox sees it
 * through from here, so the caller says nothing; false means the caller says "Delivery
 * unconfirmed" itself.
 *
 * - Its chat view is on screen with a settled transcript: that chat's recovery takes it over now.
 * - Its chat view is on screen but its transcript is not settled (loading, reloading): false. The
 *   recovery cannot tell whether it landed, and waiting for it left "Sending…" up for good.
 * - Its chat view is not on screen (hidden, or another tab shown) while the chat controller's
 *   recovery is mounted: it waits in the outbox for the next chat of its tab, which sends it once
 *   after looking for its row (the user: "Message must be sent anyway"). With no recovery mounted
 *   at all, nothing would, and the caller says so.
 * - A photo send: false. The recovery resends no files. It stays in the outbox for a later chat or
 *   process, marked as released in this run, so a recovery in this same run says delivery is
 *   unconfirmed (outboxReleasedThisRun) instead of "the app closed", false in a process that
 *   never closed.
 */
export function releaseOutboxSend(id: string | undefined): boolean {
  if (!id) {
    return false
  }
  live.delete(id)
  releasedThisRun.add(id)
  const entry = findOutboxEntry(id)
  if (entry === undefined || entry.hasAttachments) {
    return false
  }
  if ((recoveries.get(entry.draftKey) ?? 0) > 0) {
    return (settledRecoveries.get(entry.draftKey) ?? 0) > 0
  }
  return mountedRecoveries > 0
}

/** An outbox recovery is mounted (the chat controller's), whatever its tab shows. */
export function mountOutboxRecovery(): () => void {
  mountedRecoveries += 1
  return () => {
    mountedRecoveries = Math.max(0, mountedRecoveries - 1)
  }
}

/** The send carrying it stopped in this process (releaseOutboxSend), not with a process that died. */
export function outboxReleasedThisRun(id: string): boolean {
  return releasedThisRun.has(id)
}

/** A chat's recovery is mounted with its view on screen; `settled` when its transcript is a
 *  settled read too (it registers both ways then). Returns the unregister. */
export function registerOutboxRecovery(draftKey: string, settled = false): () => void {
  const counts = settled ? settledRecoveries : recoveries
  counts.set(draftKey, (counts.get(draftKey) ?? 0) + 1)
  return () => {
    const left = (counts.get(draftKey) ?? 1) - 1
    if (left > 0) {
      counts.set(draftKey, left)
    } else {
      counts.delete(draftKey)
    }
  }
}

/** Test-only: module state outlives a single test; this is a process restart. */
export function resetOutboxSendsForTests(): void {
  live.clear()
  recoveries.clear()
  settledRecoveries.clear()
  mountedRecoveries = 0
  adoptions.clear()
  releasedThisRun.clear()
}
