import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { normalizeNativeChatUserText } from '../../../src/shared/native-chat-image-transcript-markers'
import { isCutAtHookLength, isCutHandback, parseSubagentMessage } from './mobile-native-chat-agent-messages'
import { isCrossSessionMessagePrompt } from './claude-peer-message-frames'
import { isPeerRowHead } from './mobile-terminal-peer-notices'
import { dedupeWitnessReadings, preferredWitnessReading } from './mobile-native-chat-witness-dedupe'
import { asPaintedPrompt } from './mobile-terminal-prompt-paint'
import { AGENT_STATUS_MAX_FIELD_LENGTH } from '../../../src/shared/agent-status-field-normalization'
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
  const reading = { id, text }
  if (current.some((item) => preferredStoredReading(item, reading) === 'a')) {
    return previous
  }
  const kept = current.filter(
    (item) => !(isWitnessed(item.id) && preferredStoredReading(item, reading) === 'b')
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
  images?: string[],
  imagePaths?: string[]
): PendingByKey {
  const current = previous[key] ?? []
  const kept = withoutWitnessesOfSends(current, [{ text, sentAt: origin.sentAt }])
  const base = kept === current ? previous : { ...previous, [key]: kept }
  return appendMobileNativeChatPending(base, key, id, origin, text, images, imagePaths)
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
            item.witnessedAt! >= send.sentAt! && preferredStoredReading({ id: SEND_ID, text: send.text }, item) !== null
        )
      )
  )
  return kept.length === list.length ? list : kept
}

/** A witness seen before the session's stored echoes were read back
 *  (use-mobile-native-chat-pending-persistence.ts), with what it was seen
 *  against. */
export type HeldWitness = {
  id: string
  text: string
  anchorId: string
  messages: readonly NativeChatMessage[]
  draftKey: string
  /** When the phone saw it, by the phone's clock. */
  at: number
}

/**
 * The witnesses held until the session's stored echoes were read back, stored
 * now, except a copy of a stored send: the same message, seen at or after the
 * send left the phone. That is the hook's copy of a send Claude took mid-turn,
 * first seen after a remount; stored as someone else's message it could never
 * be paired with the send again, and it drew under the reply that ended the
 * turn beside the send's own bubble (reported 2026-09-25, Claude Code 2.1.282).
 * acceptOwnSendInPending applies the same rule when the send is the later of
 * the two. A message typed since with the same text is found again by the
 * pairing while the chat is open (promptTakenBetween, desktop-prompt-own-sends.ts).
 */
export function rememberHeldWitnesses(
  previous: PendingByKey,
  key: string,
  held: readonly HeldWitness[],
  stored: readonly MobileNativeChatPendingMessage[]
): PendingByKey {
  let next = previous
  for (const witness of held) {
    const copyOfSend = stored.some(
      (send) =>
        !isWitnessed(send.id) &&
        typeof send.sentAt === 'number' &&
        Number.isFinite(send.sentAt) &&
        witness.at >= send.sentAt &&
        preferredStoredReading(send, witness) !== null
    )
    if (!copyOfSend) {
      next = rememberEchoInPending(
        next,
        key,
        witness.id,
        witness.text,
        witness.anchorId,
        witness.messages,
        witness.draftKey,
        witness.at
      )
    }
  }
  return next
}

function isWitnessed(id: string): boolean {
  return id.startsWith('absorbed-') || id.startsWith('desk-')
}

/** Stands for a phone send compared by its words alone. */
const SEND_ID = 'pending-send'

/**
 * preferredWitnessReading for two copies the store holds, told apart by what
 * each is as well as by its words.
 *
 * Only a screen reading (`absorbed-`, read off the agent's queue box) can be
 * cut short or have the screen's rows glued on under the words. A hook copy
 * (`desk-`) and a phone send are the words as they were sent, so between two
 * of those, one that goes on past the other's whole words is a message of its
 * own: "… keep your Google web session. Whats this issue" and "… Whats this",
 * sent 33 s apart at the desk, were stored as one message, and the first was
 * gone whenever the chat drew from the store (device, 2026-09-29, Claude Code
 * 2.1.284). The same words are still one message, whoever holds them, and so
 * is a pair with a screen reading in it, or one whose shorter copy fills the
 * tab status's field, which Orca cuts there.
 */
function preferredStoredReading(
  a: { id: string; text: string },
  b: { id: string; text: string }
): 'a' | 'b' | null {
  const verdict = preferredWitnessReading(a.text, b.text)
  if (verdict === null) {
    return null
  }
  const [kept, dropped] = verdict === 'a' ? [a, b] : [b, a]
  const goesOn = storedKey(dropped.text).length > storedKey(kept.text).length && !storedKey(kept.text).endsWith('…')
  const whole = kept.text.length < AGENT_STATUS_MAX_FIELD_LENGTH
  const asSent = !dropped.id.startsWith('absorbed-') && !kept.id.startsWith('absorbed-')
  return goesOn && whole && asSent ? null : verdict
}

/** The words preferredWitnessReading compares. */
function storedKey(text: string): string {
  return normalizeNativeChatUserText(asPaintedPrompt(text))
}

/** What is on disk from before this rule existed: readings of one message
 *  that only differ by rows glued on collapse to the complete one. Also a
 *  subagent's `<agent-message …>`, which the prompt hook's copy stored as a
 *  witnessed desktop prompt until 2026-09-26 (desktop-prompt-merge.ts): it is
 *  not the user's, so it is not restored. Only that wrapper, which is all the
 *  old build stored that way: the shared harness classifier swept real
 *  messages that start with "A message arrived from" or "No response
 *  requested." (review of 2026-09-26). The store kept no cut flag, so a text
 *  with no closing tag counts only when it goes on with the harness's own
 *  hand-back line, or is as long as the hook's cut: taken as cut on its
 *  first line alone, it swept a person's prompt that quotes that line, and
 *  on the hand-back line alone it left a cut request (reviews of 2026-09-27). Another session's
 *  delivery too, told by the harness's opener line and envelope, which the
 *  same build stored the same way. And a queued peer message the queue box
 *  painted as the TUI's row, "Message from @a9d5c2f85e94ca47f (ctrl+o to
 *  expand)", which the queue-box witness stored as the user's message (Bug
 *  B, session 790eafa8, 2026-09-26; mobile-terminal-queued-messages.ts). */
/** How the TUI's row for a peer message ends: a row that only opens like
 *  one, "Message from @sarah: the deploy failed", is a person's message
 *  (review of 2026-09-27). */
const PEER_ROW_TAIL = /\(ctrl\+o to expand\)\s*$/

export function sweepWitnessedEchoes(
  list: readonly MobileNativeChatPendingMessage[]
): MobileNativeChatPendingMessage[] {
  const injected = (item: MobileNativeChatPendingMessage) =>
    isWitnessed(item.id) &&
    (parseSubagentMessage(item.text) !== null ||
      isCutHandback(item.text) ||
      isCutAtHookLength(item.text) ||
      isCrossSessionMessagePrompt(item.text) ||
      (item.id.startsWith('absorbed-') && isPeerRowHead(`› ${item.text}`) && PEER_ROW_TAIL.test(item.text)))
  // Phone sends first so they win against witnessed readings of themselves.
  const ordered = [...list.filter((item) => !isWitnessed(item.id)), ...list.filter((item) => isWitnessed(item.id) && !injected(item))]
  const kept = new Set(dedupeWitnessReadings(ordered, (item) => item.text, preferredStoredReading).map((item) => item.id))
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
