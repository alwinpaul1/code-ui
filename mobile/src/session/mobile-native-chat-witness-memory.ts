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
 * by a hash of its text, because the same message read twice off the screen has
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
      id: echo.id.startsWith('desk-') ? echo.id : echoMemoryId(echo.text),
      text: echo.text,
      anchorId: echo.baselineTailMessageId
    })
  }
  return out
}
