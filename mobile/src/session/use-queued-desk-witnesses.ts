import { useEffect } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { normalizeNativeChatUserText } from '../../../src/shared/native-chat-image-transcript-markers'
import { asPaintedPrompt } from './mobile-terminal-prompt-paint'
import type { MobileChatQueueEntry } from './mobile-terminal-queued-messages'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'
import { absorbedMemoryId, witnessesToRemember, type WitnessToRemember } from './mobile-native-chat-witness-memory'
import type { BoxSighting } from './use-absorbed-queue-echoes'
import { rowsFromAnchor } from './rows-from-anchor'

/**
 * The messages the agent's queue box lists that are not the phone's own
 * sends, each with where it arrived: the raw row that was last when the chat
 * first saw it in the box, the place the queue-box witness draws a message
 * the agent takes (use-absorbed-queue-echoes.ts). The chat remembers them
 * while they sit in the box, held there while a row of exactly their words
 * is listed (useQueuedOwnSends), so one the agent takes while the chat is
 * closed is still drawn where it arrived when the chat comes back. Before, a message drawn only in the box was remembered
 * nowhere, and after the chat came back its status copy, found and timed by
 * its run's start, was on a page not loaded: the message was lost (final
 * review of fix/midturn-prompt-at-end, 2026-09-29).
 *
 * Where each arrived is the queue-box witness's own sighting of its entry
 * (`box`, BoxSighting), not one kept here: its echo is remembered at that row
 * once the agent takes it, and both must name one message by one id
 * (absorbedMemoryId). A sighting kept here by the words, for good, put a later
 * message of the same words at the first one's row under the first one's id,
 * so one the agent took while the chat was closed was lost (review,
 * 2026-09-30); per entry, it goes when its entry leaves the box.
 *
 * `entries` is the box as the chat draws it (useQueuedOwnSends), index for
 * index with the box as read: a row the phone's own send stands in is not a
 * string and is left out. A reading that carries a tool's rows (`⏺`, `●`,
 * `⎿`) is the reader running into the transcript and is left out too
 * (mobile-native-chat-witness-dedupe.ts). A message already in the box when
 * the chat opened is placed where the chat first saw it, which can be below
 * rows written after it was sent.
 *
 * One whose own row has landed is not stored (landedFromSighting): a user row
 * of its words at or after the row it arrived after, the rule its echo is
 * retired by (rowsFromAnchor). A row of those words from an earlier turn is
 * another message.
 */
export function queuedDeskWitnesses(
  entries: readonly MobileChatQueueEntry[],
  box: readonly BoxSighting[],
  rawMessages: readonly NativeChatMessage[]
): WitnessToRemember[] {
  const out: WitnessToRemember[] = []
  const landed = landedFromSighting(rawMessages)
  for (const slot of box) {
    if (typeof entries[slot.row] !== 'string' || slot.sighting === null || slot.text.split('\n').some((line) => /^[⏺●⎿]/.test(line.trim()))) {
      continue
    }
    const key = normalizeNativeChatUserText(asPaintedPrompt(slot.text))
    if (key.length === 0 || landed(key, slot.sighting)) {
      continue
    }
    out.push({ id: absorbedMemoryId(slot.text, slot.sighting, slot.firstRead), text: slot.text, anchorId: slot.sighting })
  }
  return out
}

/**
 * Whether the transcript holds a user row of these words from the row the box
 * first listed the message after on (rowsFromAnchor). A box read that still
 * lists a message whose row has landed is one taken just before the read
 * (the chat opened as Claude dequeued it at a turn's end, and its row was the
 * last row then); stored, it counted that row as an older one of its words,
 * waited for a second, and was drawn under its own row for good (round 2 of
 * the review of fix/midturn-gaps). A row of the same words BEFORE that one is
 * an earlier message: counted too, a mid-turn "keep going" after an earlier
 * turn of those words was never stored, and was lost if the chat closed
 * before the agent's next row (review, 2026-09-30). The rows are read on the
 * first ask, so an empty box does not walk them.
 */
function landedFromSighting(rawMessages: readonly NativeChatMessage[]): (key: string, sighting: string) => boolean {
  let rows: NativeChatMessage[] | null = null
  let keys: string[] | null = null
  let since: ((anchorId: string | null) => boolean[]) | null = null
  return (key, sighting) => {
    rows ??= rawMessages.filter((message) => message.role === 'user')
    keys ??= rows.map((message) =>
      normalizeNativeChatUserText(asPaintedPrompt(message.blocks.map((block) => (block.type === 'text' ? block.text : '')).join(' ')))
    )
    since ??= rowsFromAnchor(rawMessages, rows)
    const after = since(sighting)
    return keys.some((landedKey, index) => after[index] && landedKey === key)
  }
}

/**
 * Keep what the chat witnessed with the phone's own sends, so it survives a
 * reconnect, a tab switch and a relaunch (2026-09-13): the echoes it drew
 * (witnessesToRemember says which, and under what id), and the messages the
 * agent's queue box lists (queuedDeskWitnesses).
 */
export function useRememberedWitnesses(
  echoes: readonly MobileNativeChatPendingMessage[],
  queued: readonly WitnessToRemember[],
  rememberEcho: ((id: string, text: string, anchorId: string | null) => void) | undefined
): void {
  const drawn = JSON.stringify(witnessesToRemember(echoes))
  const listed = JSON.stringify(queued)
  useEffect(() => {
    for (const witness of JSON.parse(drawn) as WitnessToRemember[]) {
      rememberEcho?.(witness.id, witness.text, witness.anchorId)
    }
    for (const witness of JSON.parse(listed) as WitnessToRemember[]) {
      rememberEcho?.(witness.id, witness.text, witness.anchorId)
    }
  }, [drawn, listed, rememberEcho])
}
