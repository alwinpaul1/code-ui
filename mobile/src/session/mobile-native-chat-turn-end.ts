import type { NativeChatMessage, NativeChatRole } from '../../../src/shared/native-chat-types'

/** The roles that carry on a turn the agent has begun: its words, its tool
 *  results and its thoughts. A prompt or a host notice does not. */
const CARRIES_ON_A_TURN: ReadonlySet<NativeChatRole> = new Set<NativeChatRole>(['assistant', 'tool', 'reasoning'])

/** The ids of the messages that end an agent turn: the last one before a
 *  prompt, a notice, or the end of the list. The Claude app draws a reply's
 *  actions (copy and the rest) once, under the turn's last block, not under
 *  every block of it (2026-10-09 screenshot). `messages` is in transcript
 *  order, oldest first. A user message ends nothing and is never listed. */
export function messageIdsEndingATurn(messages: readonly NativeChatMessage[]): Set<string> {
  const ending = new Set<string>()
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!
    const next = messages[index + 1]
    if (message.role !== 'user' && (!next || !CARRIES_ON_A_TURN.has(next.role))) {
      ending.add(message.id)
    }
  }
  return ending
}
