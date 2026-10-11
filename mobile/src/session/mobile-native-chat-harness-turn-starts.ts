/**
 * Rows that open a turn the harness started: the first row drawn after a harness user turn the
 * chat hides (a `<task-notification>`, a scheduled wake-up, the rest of
 * isKnownHarnessInjectedUserTurnText; mobile-native-chat-render-data.ts `stripNoise`).
 *
 * Why: with that user row gone, a reply Claude wrote because a background task finished sat
 * straight after the previous reply, and the chat took the two for one turn. The arrow under the
 * newest reply then scrolled to the start of the first one, several replies up, and the earlier
 * replies drew no actions of their own (2026-10-11 recording: tapping the arrow under "The build
 * is ready…" landed on "I've added it to the screenshot fix…"). The turn boundary has to outlive
 * the hidden row (mobile-native-chat-turn-end.ts reads it here).
 *
 * Module state, keyed by row id, so the fold that hides the row and the turn reader that needs the
 * boundary do not have to share an array. Bounded: a long session's oldest ids go first.
 */
const MAX_REMEMBERED = 4_000
const starts = new Set<string>()

export function noteHarnessTurnStart(id: string): void {
  if (starts.has(id)) {
    return
  }
  starts.add(id)
  if (starts.size > MAX_REMEMBERED) {
    const oldest = starts.values().next().value
    if (oldest !== undefined) {
      starts.delete(oldest)
    }
  }
}

export function isHarnessTurnStart(id: string): boolean {
  return starts.has(id)
}

/** `messages` without the rows `hidden` takes out, noting the first row drawn after each hidden
 *  USER turn as the start of a turn of its own. */
export function withoutHiddenTurns<T extends { id: string; role: string }>(
  messages: readonly T[],
  hidden: (message: T) => boolean
): T[] {
  const kept: T[] = []
  let afterHiddenTurn = false
  for (const message of messages) {
    if (hidden(message)) {
      afterHiddenTurn = afterHiddenTurn || message.role === 'user'
      continue
    }
    if (afterHiddenTurn) {
      noteHarnessTurnStart(message.id)
      afterHiddenTurn = false
    }
    kept.push(message)
  }
  return kept
}
