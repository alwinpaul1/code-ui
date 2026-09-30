import { useEffect } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { normalizeNativeChatUserText } from '../../../src/shared/native-chat-image-transcript-markers'
import { asPaintedPrompt } from './mobile-terminal-prompt-paint'
import type { MobileChatQueueEntry } from './mobile-terminal-queued-messages'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'
import { absorbedMemoryId, witnessesToRemember, type WitnessToRemember } from './mobile-native-chat-witness-memory'
import type { BoxSighting } from './use-absorbed-queue-echoes'

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
 */
export function queuedDeskWitnesses(
  entries: readonly MobileChatQueueEntry[],
  box: readonly BoxSighting[],
  rawMessages: readonly NativeChatMessage[]
): WitnessToRemember[] {
  const out: WitnessToRemember[] = []
  for (const slot of box) {
    if (typeof entries[slot.row] !== 'string' || slot.sighting === null || slot.text.split('\n').some((line) => /^[⏺●⎿]/.test(line.trim()))) {
      continue
    }
    const key = normalizeNativeChatUserText(asPaintedPrompt(slot.text))
    if (key.length === 0 || landedRowOf(key, rawMessages)) {
      continue
    }
    out.push({ id: absorbedMemoryId(slot.text, slot.sighting, slot.firstRead), text: slot.text, anchorId: slot.sighting })
  }
  return out
}

/**
 * Whether the transcript already holds a user row of these words. A box read
 * that still lists a message whose row has landed is one taken just before
 * the read (the chat opened as Claude dequeued it at a turn's end); stored
 * then, it counted that row as an older one of its words, waited for a
 * second, and was drawn under its own row for good (round 2 of the review of
 * fix/midturn-gaps). The same words queued again after an older prompt of
 * them are not stored either, and are drawn as before this was added.
 */
function landedRowOf(key: string, rawMessages: readonly NativeChatMessage[]): boolean {
  return rawMessages.some(
    (message) =>
      message.role === 'user' &&
      normalizeNativeChatUserText(
        asPaintedPrompt(message.blocks.map((block) => (block.type === 'text' ? block.text : '')).join(' '))
      ) === key
  )
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
