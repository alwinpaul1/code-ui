import {
  changeNativeChatOutbox,
  nativeChatOutboxEntries,
  type NativeChatOutboxAttachment,
  type NativeChatOutboxEntry,
  type NativeChatOutboxRoute
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
 * process died, or whose send ended without knowing (an unconfirmed hold that ran out), is seen
 * through from there: by its chat's recovery (use-native-chat-outbox-recovery.ts) while that chat
 * is on screen with a settled transcript, and by the app-wide drainer (native-chat-outbox-drainer.ts)
 * everywhere else, whichever chat or screen is showing. Each looks for its row first and sends it
 * again only when it did not land, under the entry's one operation id on a structured session.
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
/** Where each chat's sends go, by draft key, published by its chat controller
 *  (use-mobile-native-chat-outbox.ts) and stamped on every entry it writes. */
const chatRoutes = new Map<string, NativeChatOutboxRoute>()
/** Whether a chat on screen is safe to type into, by draft key (its recovery's `idle`). */
const chatIdle = new Map<string, boolean>()
/** The app-wide drainer is mounted (counted: tests may mount two). */
let mountedDrainers = 0
const drainWanted = new Set<() => void>()

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
  extra?: { hasAttachments?: boolean; attachments?: readonly NativeChatOutboxAttachment[]; atGate?: boolean }
): void {
  const id = origin.outboxId
  if (!id) {
    return
  }
  live.add(id)
  const route = chatRoutes.get(origin.draftKey)
  const attachments = extra?.attachments?.length ? extra.attachments.map((item) => ({ ...item })) : undefined
  const existing = findOutboxEntry(id)
  if (existing) {
    // The text leg of a photo press adopts the entry its start wrote: it knows the uploaded
    // paths (a structured session) and the chat's route, which that start may not have.
    if ((attachments && !existing.attachments) || (route && !existing.route)) {
      void patchOutboxEntry(id, {
        ...(attachments && !existing.attachments ? { attachments } : {}),
        ...(route && !existing.route ? { route: { ...route } } : {})
      })
    }
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
    ...(extra?.hasAttachments || attachments ? { hasAttachments: true as const } : {}),
    ...(attachments ? { attachments } : {}),
    ...(route ? { route: { ...route } } : {}),
    ...(extra?.atGate ? { atGate: true as const } : {}),
    autoAttempts: 0
  }
  const startedAt = Date.now()
  void changeNativeChatOutbox((current) => [...current, entry]).then(() => noteSendStage('outbox', Date.now() - startedAt))
}

/** The send got past its gate (S4): its words leave the composer now, so the entry is a send's
 *  like any other from here, kept across a restart. */
export function passOutboxGate(id: string | undefined): void {
  if (findOutboxEntry(id)?.atGate) {
    void patchOutboxEntry(id!, { atGate: undefined })
  }
}

/**
 * The gate refused the send because the desktop could not be reached (S4). Its entry, written
 * before the gate, is handed to the outbox to send once the link is back (releaseOutboxSend says
 * who). Returns false when nothing could: the caller then retires it and gives the words back.
 */
export function releaseOutboxSendFromGate(id: string | undefined): boolean {
  if (!findOutboxEntry(id)?.atGate) {
    return false
  }
  void patchOutboxEntry(id!, { atGate: undefined, unwritten: true })
  return releaseOutboxSend(id)
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

/**
 * The desktop answered the send's write (S2): its bubble comes out of its dim now, as the Claude
 * app's pending row does at its POST's ack, while the entry keeps waiting for Claude's record of
 * it. Nothing for an entry that has already left, or was marked already.
 */
export function noteOutboxSendAcked(id: string | undefined): void {
  const entry = findOutboxEntry(id)
  if (entry && !entry.hostAcked) {
    void patchOutboxEntry(entry.id, { hostAcked: true })
  }
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
 * With the app-wide drainer mounted (it always is in the app, from the root layout), every entry
 * that carries its route (and, for a photo, its uploaded paths) is seen through: by the chat's
 * recovery when that chat is on screen with a settled transcript, and by the drainer otherwise,
 * whatever chat or screen is showing (the user: "All messages must be send reliability and must
 * not drop", 2026-10-11). The rules below are for an entry without them (written by 0.9.128 or
 * earlier, or by a send with no chat route) or a process with no drainer (tests):
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
  if (entry === undefined) {
    return false
  }
  if (mountedDrainers > 0 && outboxEntryDrainable(entry)) {
    wantOutboxDrain()
    return true
  }
  if (entry.hasAttachments) {
    return false
  }
  if ((recoveries.get(entry.draftKey) ?? 0) > 0) {
    return (settledRecoveries.get(entry.draftKey) ?? 0) > 0
  }
  return mountedRecoveries > 0
}

/** Whether the app-wide drainer can send this entry with no chat on screen: it knows where the
 *  entry goes (with its session and, for a terminal, its agent) and, for photos and files, the
 *  desktop paths to send again. */
export function outboxEntryDrainable(entry: NativeChatOutboxEntry): boolean {
  const route = entry.route
  if (!route || !route.sessionId || (route.lane === 'terminal' && !route.agent)) {
    // With no session (a first message before the agent named one) the drainer has no transcript
    // to look in and no session to send to: the chat's recovery sees it through, as before.
    return false
  }
  return !entry.hasAttachments || (entry.attachments?.length ?? 0) > 0
}

/** The chat controller publishes where this chat's sends go; returns the unpublish. */
export function publishOutboxChatRoute(draftKey: string, route: NativeChatOutboxRoute): () => void {
  chatRoutes.set(draftKey, route)
  return () => {
    if (chatRoutes.get(draftKey) === route) {
      chatRoutes.delete(draftKey)
    }
  }
}

/** A chat on screen says whether it is safe to type into (its composer empty, the agent idle). */
export function publishOutboxChatIdle(draftKey: string, idle: boolean): () => void {
  chatIdle.set(draftKey, idle)
  return () => {
    if (chatIdle.get(draftKey) === idle) {
      chatIdle.delete(draftKey)
    }
  }
}

/** Whether a chat whose view is on screen reported itself safe to type into; true for a chat not
 *  on screen, which has no phone composer mirroring into its terminal. */
export function outboxChatIdleOrHidden(draftKey: string): boolean {
  return (recoveries.get(draftKey) ?? 0) === 0 || chatIdle.get(draftKey) === true
}

/** A chat's recovery is on screen with a settled transcript: it sees that chat's text entries through. */
export function outboxChatRecoveryOwns(draftKey: string): boolean {
  return (recoveries.get(draftKey) ?? 0) > 0 && (settledRecoveries.get(draftKey) ?? 0) > 0
}

/** Takes the entry for one automatic send: false when a send already carries it. */
export function claimOutboxSend(id: string): boolean {
  if (live.has(id)) {
    return false
  }
  live.add(id)
  return true
}

/** The automatic send that claimed it is over; the entry is free again (if still there). */
export function unclaimOutboxSend(id: string): void {
  live.delete(id)
}

/** The app-wide drainer is mounted; returns the unmount. */
export function mountOutboxDrainer(): () => void {
  mountedDrainers += 1
  return () => {
    mountedDrainers = Math.max(0, mountedDrainers - 1)
  }
}

/** Something happened that the drainer should look at now (a send released, a Retry). */
export function wantOutboxDrain(): void {
  for (const listener of drainWanted) {
    listener()
  }
}

export function subscribeOutboxDrainWanted(listener: () => void): () => void {
  drainWanted.add(listener)
  return () => {
    drainWanted.delete(listener)
  }
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
  chatRoutes.clear()
  chatIdle.clear()
  mountedDrainers = 0
  drainWanted.clear()
}
