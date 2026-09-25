import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { normalizeNativeChatUserText } from '../../../src/shared/native-chat-image-transcript-markers'
import { dedupeWitnessReadings, preferredWitnessReading } from './mobile-native-chat-witness-dedupe'
import { countUserTextOccurrences, normalizeReconcileText } from './mobile-native-chat-draft-reconcile'
import {
  appendMobileNativeChatPending,
  type MobileNativeChatPendingMessage,
  type MobileNativeChatSendOrigin
} from './mobile-native-chat-pending-echo'

type PendingByKey = Record<string, MobileNativeChatPendingMessage[]>

/**
 * Keep a message the phone only WITNESSED — typed on the desktop and absorbed
 * mid-turn, or delivered by the hook — in the same persisted store as the
 * phone's own sends.
 *
 * Why: such a message never gets a transcript row, so until now it lived only
 * in the witness hooks' memory, and a reconnect, a tab switch or a relaunch
 * wiped it. On 2026-09-13 a message sent from the Claude app mid-turn showed
 * on the phone right after an install and was gone an hour later. Stored
 * here it is placed at its anchor row like any pending send, comes back on
 * relaunch, and retires only if a transcript row for it ever lands.
 */
export function rememberEchoInPending(
  previous: PendingByKey,
  key: string,
  id: string,
  text: string,
  anchorId: string,
  messages: readonly NativeChatMessage[],
  draftKey: string,
  now = Date.now()
): PendingByKey {
  const current = previous[key] ?? []
  if (current.some((item) => item.id === id)) {
    return previous
  }
  // A reading that only extends a complete one already stored is the
  // screen's own rows glued on; and a stored reading that this one beats
  // (a `…` stub, or a glued variant) gives way to it.
  // …and a phone send of its own beats a witnessed reading that glues rows
  // onto it, whichever came first: this is the send-first order, and
  // acceptOwnSendInPending below is the witness-first one.
  if (current.some((item) => preferredWitnessReading(item.text, text) === 'a')) {
    return previous
  }
  const kept = current.filter(
    (item) => !(isWitnessed(item.id) && preferredWitnessReading(item.text, text) === 'b')
  )
  const base = kept.length === current.length ? previous : { ...previous, [key]: kept }
  const normalizedText = normalizeReconcileText(text)
  const next = appendMobileNativeChatPending(
    base,
    key,
    id,
    {
      draftKey,
      draftEditGeneration: 0,
      pendingKey: key,
      normalizedText,
      baselineOccurrences: countUserTextOccurrences(messages, normalizedText),
      baselineTailMessageId: anchorId,
      baselineResolved: true
    },
    text
  )
  const list = next[key]!
  return { ...next, [key]: [...list.slice(0, -1), { ...list.at(-1)!, witnessedAt: now }] }
}

/**
 * The phone's own send, in place of any witness of it stored before its ack.
 *
 * A text send gets its bubble only when the write is acknowledged, and over
 * the relay that can come after the other copies of the same message: Orca's
 * hook reports it the moment Claude takes the Enter, and the queue box paints
 * it. A copy drawn in that gap is remembered here as `desk-`/`absorbed-`, and
 * from then on it was someone else's message: the send could not claim the
 * hook's copy it was paired against (desktop-prompt-own-sends.ts), and both
 * drew — "Working W capital" twice once Claude took it (2026-09-25, Claude
 * Code 2.1.281). The rule above — a phone send beats its own witness — only
 * ever held when the send was stored first.
 *
 * So a witness of the same message stored at or after the moment this send
 * left the phone is this send, and goes. One stored before the tap is a real
 * earlier message, typed at the desk, and stays; so does one from a build that
 * did not stamp the time.
 */
export function acceptOwnSendInPending(
  previous: PendingByKey,
  key: string,
  id: string,
  origin: MobileNativeChatSendOrigin,
  text: string,
  images?: string[]
): PendingByKey {
  const current = previous[key] ?? []
  const sentAt = origin.sentAt
  const kept =
    typeof sentAt === 'number'
      ? current.filter(
          (item) =>
            !(
              isWitnessed(item.id) &&
              typeof item.witnessedAt === 'number' &&
              item.witnessedAt >= sentAt &&
              preferredWitnessReading(text, item.text) !== null
            )
        )
      : current
  const base = kept.length === current.length ? previous : { ...previous, [key]: kept }
  return appendMobileNativeChatPending(base, key, id, origin, text, images)
}

function isWitnessed(id: string): boolean {
  return id.startsWith('absorbed-') || id.startsWith('desk-')
}

/** What is on disk from before this rule existed: readings of one message
 *  that only differ by rows glued on collapse to the complete one. */
export function sweepWitnessedEchoes(
  list: readonly MobileNativeChatPendingMessage[]
): MobileNativeChatPendingMessage[] {
  // Phone sends first so they win against witnessed readings of themselves.
  const ordered = [...list.filter((item) => !isWitnessed(item.id)), ...list.filter((item) => isWitnessed(item.id))]
  const kept = new Set(dedupeWitnessReadings(ordered, (item) => item.text).map((item) => item.id))
  const swept = list.filter((item) => !isWitnessed(item.id) || kept.has(item.id))
  return swept.length === list.length ? [...list] : swept
}

/** One id per message text, stable across mounts and relaunches, so a witness
 *  that re-finds the same message never stores it twice. */
export function echoMemoryId(text: string): string {
  const key = normalizeNativeChatUserText(text)
  let hash = 5381
  for (let index = 0; index < key.length; index += 1) {
    hash = ((hash << 5) + hash + key.charCodeAt(index)) | 0
  }
  return `absorbed-${(hash >>> 0).toString(36)}-${key.length}`
}
