import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { normalizeNativeChatUserText } from '../../../src/shared/native-chat-image-transcript-markers'
import { dedupeWitnessReadings, preferredWitnessReading } from './mobile-native-chat-witness-dedupe'
import { countUserTextOccurrences, normalizeReconcileText } from './mobile-native-chat-draft-reconcile'
import {
  appendMobileNativeChatPending,
  type MobileNativeChatPendingMessage
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
  draftKey: string
): PendingByKey {
  const current = previous[key] ?? []
  if (current.some((item) => item.id === id)) {
    return previous
  }
  // A reading that only extends a complete one already stored is the
  // screen's own rows glued on; and a stored reading that this one beats
  // (a `…` stub, or a glued variant) gives way to it.
  if (current.some((item) => isWitnessed(item.id) && preferredWitnessReading(item.text, text) === 'a')) {
    return previous
  }
  const kept = current.filter(
    (item) => !(isWitnessed(item.id) && preferredWitnessReading(item.text, text) === 'b')
  )
  const base = kept.length === current.length ? previous : { ...previous, [key]: kept }
  const normalizedText = normalizeReconcileText(text)
  return appendMobileNativeChatPending(
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
}

function isWitnessed(id: string): boolean {
  return id.startsWith('absorbed-') || id.startsWith('desk-')
}

/** What is on disk from before this rule existed: readings of one message
 *  that only differ by rows glued on collapse to the complete one. */
export function sweepWitnessedEchoes(
  list: readonly MobileNativeChatPendingMessage[]
): MobileNativeChatPendingMessage[] {
  const witnessed = dedupeWitnessReadings(
    list.filter((item) => isWitnessed(item.id)),
    (item) => item.text
  )
  const keep = new Set(witnessed.map((item) => item.id))
  const swept = list.filter((item) => !isWitnessed(item.id) || keep.has(item.id))
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
