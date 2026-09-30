import { echoMemoryId } from './mobile-native-chat-remember-echo'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'

export type WitnessToRemember = { id: string; text: string; anchorId: string }

/**
 * Which witnessed echoes may be written to disk, and under what id.
 *
 * A witnessed message — typed on the desktop, or absorbed from the agent's own
 * queue — never gets a transcript row of its own, so the phone's copy is the
 * only one and it has to survive a reconnect, a tab switch and a relaunch.
 *
 * Two rules decide it, and both were inline in the overlay's effect where
 * nothing could test them (2026-09-15):
 *
 * - A PROVISIONAL echo is never written. On its first reading of a session the
 *   absorbed-queue path may hold the single newest unlanded prompt as a guess,
 *   because the agent's scrollback is a backlog rather than an event stream.
 *   Persisting a guess makes it permanent, and the bug that rule came from was
 *   the whole backlog drawn as stacked bubbles with no replies between them
 *   ("why is all my messages stacked like these", 2026-09-13).
 * - An echo with no anchor is not written either: it has no position to be
 *   restored into, and a restored echo with no boundary must never come back as
 *   a new send.
 *
 * The id is the memory key. A desktop prompt keeps its own `desk-<nonce>` id so
 * repeated beacons of one prompt map to one entry; an absorbed reading is keyed
 * by absorbedMemoryId, because the same message read twice off the screen has
 * no other stable identity.
 */
export function witnessesToRemember(
  echoes: readonly MobileNativeChatPendingMessage[]
): WitnessToRemember[] {
  const out: WitnessToRemember[] = []
  for (const echo of echoes) {
    if (!echo.baselineTailMessageId || echo.provisional) {
      continue
    }
    out.push({
      id: echo.id.startsWith('desk-')
        ? echo.id
        : absorbedMemoryId(echo.text, echo.baselineTailMessageId, echo.listedAtFirstRead === true),
      text: echo.text,
      anchorId: echo.baselineTailMessageId
    })
  }
  return out
}

/**
 * The id a message read off the agent's queue box is remembered under, by
 * both of its writers: its echo once the agent takes it (witnessesToRemember)
 * and the box's own witness while it waits (queuedDeskWitnesses). Both anchor
 * it at the row the box first listed it after, the one sighting the queue-box
 * witness keeps per entry (use-absorbed-queue-echoes.ts), so one message has
 * one id and two messages of the same words have two (review, 2026-09-30).
 *
 * A message the box already listed when the chat first read it is remembered
 * by its words alone: it may be one the chat stored before a remount, where
 * the box first listed it then, and the store joins a reading by its words
 * alone to any stored reading of those words (mobile-native-chat-remember-echo.ts).
 */
export function absorbedMemoryId(text: string, anchorId: string, listedAtFirstRead: boolean): string {
  return echoMemoryId(text, listedAtFirstRead ? null : anchorId)
}
