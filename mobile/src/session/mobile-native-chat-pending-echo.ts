import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { countUserTextOccurrences, normalizeReconcileText } from './mobile-native-chat-draft-reconcile'
import { highestImageMarker } from './mobile-native-chat-image-transcript-markers'

export type MobileNativeChatPendingMessage = {
  id: string
  text: string
  expectedOccurrence: number
  /** Local preview URIs carried by the send for its optimistic echo. */
  images?: string[]
  /** The desktop paths the send pasted, one per preview in `images` and in
   *  the same order. The agent's row names them (`[Image: source: …]`), so
   *  they tell the send's own row from any other photo row
   *  (mobile-native-chat-draft-reconcile.ts). Absent on sends from an older
   *  build, and dropped whenever it does not pair with `images`. */
  imagePaths?: string[]
  baselineTailMessageId: string | null
  /** Where to DRAW an echo that captured no boundary of its own, kept apart
   *  from `baselineTailMessageId` because reconciliation and placement want
   *  opposite things out of the same row. An image echo counts the image turns
   *  AFTER its boundary, so a boundary taken from a read that already carries
   *  the echo's own row would strand the bubble forever (see the rebase) — but
   *  it still has to be drawn somewhere, and with nothing here that somewhere
   *  is the bottom of the conversation, under every reply that answered it.
   *  Nothing that reconciles, glues or retires reads this. */
  placementAnchorId?: string | null
  /** Where to DRAW a mid-turn send once a row written before it has loaded
   *  below its boundary (mid-turn-written-before.ts). Placement and folding
   *  only; nothing that reconciles, glues or retires reads it. */
  drawAfterId?: string | null
  /** When the phone sent it, by the phone's clock. Absent on sends restored
   *  from an older build. */
  sentAt?: number
  /** A send made before the read settled: the last row of the read it
   *  settled on. A row after it arrived after the send; one at or before it
   *  was already written (mobile-native-chat-draft-reconcile.ts). */
  settledTailId?: string | null
  /** The same send: the last row of that read the desk wrote before the
   *  send, by the desk's own clock, or null. */
  settledWrittenBeforeId?: string | null
  /** A photo send only: the highest `[Image #N]` the transcript named when it
   *  left the phone. Its own photos are numbered above that, so a hook copy
   *  numbered at or below it is an older photo's (desktop-prompt-photo-copies.ts). */
  markersBefore?: number
  /** A witnessed message only (`desk-`/`absorbed-`): when the phone stored
   *  it, by the phone's clock, so a send whose ack came after it can tell its
   *  own witness from an older message (acceptOwnSendInPending). Absent on
   *  witnesses stored by an older build. */
  witnessedAt?: number
  /** Whether the transcript this baseline was captured from was already this
   *  session's own history. A send issued mid-hydration is captured unresolved
   *  and rebased onto the first authoritative read instead of reconciling
   *  against rows that may belong to another tab. */
  baselineResolved: boolean
  /** Restored echoes with no retained boundary must not appear as new sends. */
  restored?: boolean
  /** Sent before the chat's read settled: its tail was whatever the phone had
   *  on screen, so rows stamped well before it are not its (the photo binder,
   *  mobile-native-chat-draft-reconcile.ts). Kept through the rebase. */
  sentBeforeReadSettled?: boolean
  /** Held from the first screen reading, anchored to whatever the tail was
   *  then: drawn, but never written to disk (2026-09-13). */
  provisional?: boolean
  /** The phone's own send only: when, by the phone's clock, the agent took it
   *  out of its queue box. Claude Code writes no row for a prompt it takes
   *  mid-turn (see `isTakenSend`), so from then on the send waits for none. */
  takenAt?: number
}

/**
 * Whether the agent has taken this send out of its queue box.
 *
 * Claude Code writes a prompt it takes mid-turn only as a `queued_command`
 * attachment (queue-operation remove, reason `absorbed_mid_turn`), which
 * Orca's reader drops; a prompt still queued when the turn ends it writes as a
 * `user` row with `promptSource: "queued"`. On this machine, from 2.1.205 to
 * 2.1.282, 1,998 human prompts were written the first way and 378 the second
 * (65 and 16 on 2.1.280 to 2.1.282); 2.1.283's binary writes both the same
 * way (its strings, 2026-09-25). The phone cannot tell which it will be
 * from the box letting go, and the box also looks empty when a relay drop
 * hands the chat no queue, so a taken send still leaves on its own row if one
 * lands (retireLandedMobileNativeChatPending). What changes is that it no
 * longer counts as a send still waiting, which put a later send of the same
 * text one ordinal past its own row, so the later one drew twice and this one
 * was retired by that row (2026-09-25). The pending store does not check the
 * field it reads back.
 */
export function isTakenSend(item: Pick<MobileNativeChatPendingMessage, 'takenAt'>): boolean {
  return typeof item.takenAt === 'number' && Number.isFinite(item.takenAt)
}

/** The desktop paths `imagePaths` holds when it pairs one to one with
 *  `images`, or undefined: a list that does not pair, from a bad write or an
 *  older build, is read as no paths at all. */
export function pairedImagePaths(
  item: Pick<MobileNativeChatPendingMessage, 'images' | 'imagePaths'>
): string[] | undefined {
  const { images, imagePaths } = item
  return Array.isArray(images) &&
    Array.isArray(imagePaths) &&
    imagePaths.length === images.length &&
    imagePaths.every((path) => typeof path === 'string' && path.length > 0)
    ? imagePaths
    : undefined
}

/** `item` with only the photos whose preview `keep` takes, each desktop path
 *  kept with its own preview. No photo left drops both lists. */
export function withPhotosWhere<T extends Pick<MobileNativeChatPendingMessage, 'images' | 'imagePaths'>>(
  item: T,
  keep: (uri: string) => boolean
): T {
  const paths = pairedImagePaths(item)
  const { images: _images, imagePaths: _paths, ...rest } = item
  const kept = (item.images ?? []).flatMap((uri, index) => (keep(uri) ? [{ uri, path: paths?.[index] }] : []))
  if (kept.length === 0) {
    return rest as T
  }
  const images = kept.map((photo) => photo.uri)
  return (paths ? { ...rest, images, imagePaths: kept.map((photo) => photo.path!) } : { ...rest, images }) as T
}

export type MobileNativeChatSendOrigin = {
  draftKey: string
  draftEditGeneration: number
  pendingKey: string | null
  normalizedText: string
  baselineOccurrences: number
  baselineTailMessageId: string | null
  baselineResolved: boolean
  /** When the send left the phone, by the phone's clock. */
  sentAt?: number
  /** The highest `[Image #N]` the transcript named then. */
  markersBefore?: number
  /** Prompt-receipt nonces already reported when this send left the phone, so a
   *  receipt older than the send cannot later be read as its confirmation. */
  knownReceiptNonces?: ReadonlySet<string>
}

/** Where and when a send leaves the phone: how often its text already shows,
 *  the last row the phone holds, and the phone's clock. */
export function captureSendBoundary(
  messages: readonly NativeChatMessage[],
  normalizedText: string
): Pick<MobileNativeChatSendOrigin, 'baselineOccurrences' | 'baselineTailMessageId' | 'sentAt' | 'markersBefore'> {
  return {
    baselineOccurrences: countUserTextOccurrences(messages, normalizedText),
    baselineTailMessageId: messages.at(-1)?.id ?? null,
    sentAt: Date.now(),
    markersBefore: highestImageMarker(messages)
  }
}

type PendingByKey = Record<string, MobileNativeChatPendingMessage[]>

export function combineMobileNativeChatPending(
  session: MobileNativeChatPendingMessage[],
  waiting: readonly MobileNativeChatPendingMessage[]
): MobileNativeChatPendingMessage[] {
  if (waiting.length === 0) {
    return session
  }
  const sessionIds = new Set(session.map((item) => item.id))
  return [...session, ...waiting.filter((item) => !sessionIds.has(item.id))]
}

export function appendMobileNativeChatPending(
  previous: PendingByKey,
  key: string,
  id: string,
  origin: MobileNativeChatSendOrigin,
  text: string,
  images?: string[],
  imagePaths?: string[]
): PendingByKey {
  const current = previous[key] ?? []
  const paths = pairedImagePaths({ images, imagePaths })
  // Count outstanding repeats with the same normalized key. A send the agent
  // took is not outstanding: no row is owed for it (isTakenSend).
  const earlierOutstanding = current.filter(
    (pending) =>
      !isTakenSend(pending) &&
      normalizeReconcileText(pending.text) === origin.normalizedText &&
      pending.expectedOccurrence > origin.baselineOccurrences
  ).length
  // Image ordinal selection and counting must share the empty-text discriminator.
  const expectedImageEchoOrdinal =
    current.filter(
      (pending) => normalizeReconcileText(pending.text) === '' && pending.images?.length
    ).length + 1
  return {
    ...previous,
    [key]: [
      ...current,
      {
        id,
        text,
        expectedOccurrence:
          origin.normalizedText === ''
            ? expectedImageEchoOrdinal
            : origin.baselineOccurrences + earlierOutstanding + 1,
        baselineTailMessageId: origin.baselineTailMessageId,
        baselineResolved: origin.baselineResolved,
        ...(origin.baselineResolved ? {} : { sentBeforeReadSettled: true }),
        ...(origin.sentAt !== undefined ? { sentAt: origin.sentAt } : {}),
        ...(images?.length ? { images } : {}),
        ...(images?.length && paths ? { imagePaths: paths } : {}),
        ...(images?.length && origin.markersBefore ? { markersBefore: origin.markersBefore } : {})
      }
    ]
  }
}

export function mergeWaitingSessionPending(
  previous: PendingByKey,
  sessionKey: string,
  waiting: readonly MobileNativeChatPendingMessage[]
): PendingByKey {
  const current = previous[sessionKey] ?? []
  const currentIds = new Set(current.map((item) => item.id))
  const moved = waiting.filter((item) => !currentIds.has(item.id))
  return moved.length > 0 ? { ...previous, [sessionKey]: [...current, ...moved] } : previous
}

export function removeWaitingSessionPending(
  previous: PendingByKey,
  draftKey: string,
  movedIds: ReadonlySet<string>
): PendingByKey {
  const remaining = (previous[draftKey] ?? []).filter((item) => !movedIds.has(item.id))
  if (remaining.length > 0) {
    return { ...previous, [draftKey]: remaining }
  }
  if (!(draftKey in previous)) {
    return previous
  }
  const next = { ...previous }
  delete next[draftKey]
  return next
}

/**
 * Mark the phone's own sends the agent has taken out of its queue box
 * (`isTakenSend`), or move the time of one taken already that the box let go
 * again. The same object back when nothing changes.
 *
 * A later send of the same text counted each of these as still outstanding
 * when it was sent, so its ordinal is one too high by each: brought back down
 * here, or its own row could never retire it. Witnessed messages and a
 * caption-less photo are left alone: neither is counted this way.
 */
export function takeMobileNativeChatPending(
  previous: PendingByKey,
  key: string,
  ids: readonly string[],
  now = Date.now()
): PendingByKey {
  const current = previous[key]
  if (!current?.length || ids.length === 0) {
    return previous
  }
  const wanted = new Set(ids)
  const next = [...current]
  let changed = false
  for (let index = 0; index < next.length; index += 1) {
    const item = next[index]!
    const text = normalizeReconcileText(item.text)
    if (!wanted.has(item.id) || !item.id.startsWith('pending-') || text === '') {
      continue
    }
    // Let go again after being back in the box: only the latest release says
    // when Claude dequeued it (retireLandedMobileNativeChatPending), and its
    // ordinal was already brought down the first time.
    if (isTakenSend(item)) {
      if (item.takenAt !== now) {
        next[index] = { ...item, takenAt: now }
        changed = true
      }
      continue
    }
    next[index] = { ...item, takenAt: now }
    changed = true
    for (let later = index + 1; later < next.length; later += 1) {
      const other = next[later]!
      if (
        !isTakenSend(other) &&
        normalizeReconcileText(other.text) === text &&
        other.expectedOccurrence > item.expectedOccurrence
      ) {
        next[later] = { ...other, expectedOccurrence: other.expectedOccurrence - 1 }
      }
    }
  }
  return changed ? { ...previous, [key]: next } : previous
}

/** Drop one echo by id from every key; returns the same object when nothing changed
 *  (a cancelled queued entry must not leave its bubble behind). */
export function dropMobileNativeChatPending(previous: PendingByKey, id: string): PendingByKey {
  let changed = false
  const next: PendingByKey = {}
  for (const [key, items] of Object.entries(previous)) {
    const kept = items.filter((item) => item.id !== id)
    changed ||= kept.length !== items.length
    next[key] = kept
  }
  return changed ? next : previous
}
