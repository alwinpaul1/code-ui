import { isTextBlock, type NativeChatMessage, type NativeChatRole } from '../../../src/shared/native-chat-types'
import { agentMessageOf } from './mobile-native-chat-agent-messages'
import { nativeChatMessageText, nativeChatReplyPlainText } from './mobile-native-chat-message-text'
import { drawnNativeChatBlocks } from './mobile-native-chat-subagent-group-blocks'
import { isRenderableNativeChatNotice } from './mobile-native-chat-notice-kind'
import { isPeerBoilerplateRow } from './mobile-native-chat-peer-messages'

/** The roles that carry on a turn the agent has begun: its words, its tool
 *  results and its thoughts. A prompt or a host notice does not. */
const CARRIES_ON_A_TURN: ReadonlySet<NativeChatRole> = new Set<NativeChatRole>(['assistant', 'tool', 'reasoning'])

/** One agent turn, as its last row's actions see it. */
export type AgentTurn = {
  /** Transcript index of the turn's first row: the first after the prompt
   *  (or after the notice that cut the turn), a thought included. The
   *  scroll-up arrow brings this row to the top, the start of the reply. */
  firstIndex: number
  /** The rows of the turn that draw as the agent's reply (the rows that each
   *  carried their own Copy before it moved to the turn's end), oldest first. */
  replyRows: readonly NativeChatMessage[]
  /** Whether any of those rows has words, without the Markdown pass. */
  hasProse: boolean
}

/** Whether a row draws as the agent's reply and so can carry its actions:
 *  not a prompt, a thought, a host notice, the harness's words around a peer
 *  message or a subagent's message, which MobileNativeChatMessage draws
 *  without them. A system row whose hint this build does not know falls
 *  through to ordinary prose there, and does here too. */
function drawsAsReply(message: NativeChatMessage): boolean {
  if (message.role === 'user' || message.role === 'reasoning') {
    return false
  }
  if (message.role !== 'system') {
    return true
  }
  return (
    !isPeerBoilerplateRow(message) &&
    agentMessageOf(message) === null &&
    !message.blocks.some((block) => isTextBlock(block) && isRenderableNativeChatNotice(block))
  )
}

/** The agent turns of a transcript, keyed by the id of the row that ends each:
 *  the last row of the turn that draws as the reply. The Claude app draws a
 *  reply's actions (copy and the rest) once, under the turn's last block, not
 *  under every block of it (2026-10-09 screenshot), and its Copy copies the
 *  whole reply. A turn runs from the row after a prompt or a notice to the row
 *  before the next one, or the end of the list. A turn's newest row may be a
 *  thought, which draws no actions, so the end is the last row that can; a
 *  turn with none (a lone thought) has no end. `messages` is in transcript
 *  order, oldest first. */
export function agentTurnsByEnd(messages: readonly NativeChatMessage[]): Map<string, AgentTurn> {
  const turns = new Map<string, AgentTurn>()
  let first = -1
  let replyRows: NativeChatMessage[] = []
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!
    if (message.role === 'user') {
      continue
    }
    if (first === -1) {
      first = index
      replyRows = []
    }
    if (drawsAsReply(message)) {
      replyRows.push(message)
    }
    const next = messages[index + 1]
    if (!next || !CARRIES_ON_A_TURN.has(next.role)) {
      const end = replyRows.at(-1)
      if (end) {
        turns.set(end.id, {
          firstIndex: first,
          replyRows,
          // What the rows draw: a roster's frozen sentence is not on screen (#26125).
          hasProse: replyRows.some((row) => nativeChatMessageText(drawnNativeChatBlocks(row.blocks)) !== '')
        })
      }
      first = -1
    }
  }
  return turns
}

/** The ids of the rows that end an agent turn (see agentTurnsByEnd). A user
 *  message ends nothing and is never listed. */
export function messageIdsEndingATurn(messages: readonly NativeChatMessage[]): Set<string> {
  return new Set(agentTurnsByEnd(messages).keys())
}

/** What the Copy under a turn puts on the clipboard: each reply row's words as
 *  a single row's Copy gave them (the words drawn, not the Markdown source),
 *  oldest first, a blank line apart. Empty when no row has words. */
export function agentTurnPlainText(turn: AgentTurn): string {
  return turn.replyRows
    .map((row) => nativeChatReplyPlainText(drawnNativeChatBlocks(row.blocks)))
    .filter((text) => text !== '')
    .join('\n\n')
}
