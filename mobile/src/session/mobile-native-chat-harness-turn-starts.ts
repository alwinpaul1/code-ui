import { isTextBlock, type NativeChatMessage } from '../../../src/shared/native-chat-types'

/**
 * Rows that open a turn a background task started: the first row drawn after a hidden
 * `<task-notification>` user turn (mobile-native-chat-render-data.ts `stripNoise` hides it).
 *
 * Why: with that user row gone, a reply Claude wrote because a background task finished sat
 * straight after the previous reply, and the chat took the two for one turn: only the newest
 * reply drew actions, and its Copy copied every reply since the user last wrote (2026-10-11,
 * session 0954729d, Claude Code 2.1.296). The turn boundary has to outlive the hidden row
 * (mobile-native-chat-turn-end.ts reads it here).
 *
 * Only a task notification: it is a user turn Claude starts a turn on. Other hidden harness rows
 * (a `<system-reminder>`, an MCP update) can sit inside a turn, and a mark after them would cut one
 * reply in two (Opus review of 0176d0563).
 *
 * Keyed by the row OBJECT, not its id: no id from one session or tab can split a turn in another
 * (ids built from a position repeat). A row the render copies (a Read's picture placed into it)
 * loses the mark and reads as before, merged, never split.
 */
const starts = new WeakSet<object>()

function opensATurn(message: NativeChatMessage): boolean {
  return (
    message.role === 'user' &&
    message.blocks.some((block) => isTextBlock(block) && block.text.trimStart().startsWith('<task-notification>'))
  )
}

export function isHarnessTurnStart(message: object): boolean {
  return starts.has(message)
}

/** `messages` without the rows `hidden` takes out, marking the first row drawn after a hidden task
 *  notification as the start of a turn of its own. */
export function withoutHiddenTurns(
  messages: readonly NativeChatMessage[],
  hidden: (message: NativeChatMessage) => boolean
): NativeChatMessage[] {
  const kept: NativeChatMessage[] = []
  let afterNotification = false
  for (const message of messages) {
    if (hidden(message)) {
      afterNotification = afterNotification || opensATurn(message)
      continue
    }
    if (afterNotification) {
      starts.add(message)
      afterNotification = false
    }
    kept.push(message)
  }
  return kept
}
