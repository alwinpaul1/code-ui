import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { normalizeNativeChatUserText } from '../../../src/shared/native-chat-image-transcript-markers'
import { dedupeWitnessReadings, preferredWitnessReading } from './mobile-native-chat-witness-dedupe'
import {
  countUserTextOccurrences,
  normalizeReconcileText,
  normalizedUserText
} from './mobile-native-chat-draft-reconcile'
import { isKnownHarnessInjectedUserTurnText } from '../../../src/shared/harness-injected-user-turns'
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
  const kept = withoutWitnessesOfSends(current, [{ text, sentAt: origin.sentAt }])
  const base = kept === current ? previous : { ...previous, [key]: kept }
  return appendMobileNativeChatPending(base, key, id, origin, text, images)
}

/**
 * `list` without the witnesses (`desk-`/`absorbed-`) of any of `sends`: a
 * reading of the same message stored at or after the send left the phone.
 * The same list back when nothing goes.
 *
 * Also run when a tab's stored echoes are read back and merged with the live
 * ones: a send acknowledged while another tab was on screen dropped its
 * witness in memory only, since only the tab on screen is written, and the
 * copy on disk came back beside it (second review, 2026-09-25).
 */
export function withoutWitnessesOfSends(
  list: MobileNativeChatPendingMessage[],
  sends: readonly { text: string; sentAt?: number }[]
): MobileNativeChatPendingMessage[] {
  const timed = sends.filter((send) => typeof send.sentAt === 'number' && Number.isFinite(send.sentAt))
  if (timed.length === 0) {
    return list
  }
  const kept = list.filter(
    (item) =>
      !(
        isWitnessed(item.id) &&
        typeof item.witnessedAt === 'number' &&
        timed.some(
          (send) =>
            item.witnessedAt! >= send.sentAt! && preferredWitnessReading(send.text, item.text) !== null
        )
      )
  )
  return kept.length === list.length ? list : kept
}

/**
 * Whether the session took a prompt after this send left the phone: a user
 * row stamped later than the send by more than `marginMs`, not one the harness
 * injects (Orca's hook keeps the tab status's prompt through those). The tab
 * status then carries a newer submission than the send, so a hook copy with
 * the send's text is a message typed since, not the send (review, 2026-09-25:
 * a message typed at the desk in a later turn was hidden as a copy of an older
 * phone send). Rows the phone does not hold say nothing, so a window with none
 * after the send answers no.
 */
export function promptTakenSince(
  messages: readonly NativeChatMessage[],
  send: { sentAt?: number },
  marginMs: number
): boolean {
  const sentAt = send.sentAt
  if (typeof sentAt !== 'number' || !Number.isFinite(sentAt)) {
    return false
  }
  return messages.some((message) => {
    if (message.role !== 'user' || message.timestamp === null || message.timestamp <= sentAt + marginMs) {
      return false
    }
    const text = normalizedUserText(message)
    return Boolean(text) && !isKnownHarnessInjectedUserTurnText(text!)
  })
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
