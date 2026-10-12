import {
  isTextBlock,
  isToolCallBlock,
  isToolResultBlock,
  type NativeChatBlock,
  type NativeChatMessage,
  type NativeChatRole
} from '../../../src/shared/native-chat-types'
import { agentMessageOf } from './mobile-native-chat-agent-messages'
import type { NativeChatAgentRunInputs } from './mobile-native-chat-agent-run'
import { toolRunProgress } from './mobile-native-chat-tool-run-progress'
import { nativeChatMessageText, nativeChatReplyPlainText } from './mobile-native-chat-message-text'
import { drawnNativeChatBlocks } from './mobile-native-chat-subagent-group-blocks'
import { isRenderableNativeChatNotice } from './mobile-native-chat-notice-kind'
import { isPeerBoilerplateRow } from './mobile-native-chat-peer-messages'
import { isHarnessTurnStart } from './mobile-native-chat-harness-turn-starts'
import { errorRowOf } from './mobile-native-chat-error-rows'

/** The roles that carry on a turn the agent has begun: its words, its tool
 *  results and its thoughts. A prompt or a host notice does not. */
const CARRIES_ON_A_TURN: ReadonlySet<NativeChatRole> = new Set<NativeChatRole>(['assistant', 'tool', 'reasoning'])

/** One agent turn, as its last row's actions see it. */
export type AgentTurn = {
  /** Whether nothing follows the turn but messages the phone sent that the
   *  transcript has not taken yet (their echoes), so the agent's working
   *  state is about this turn. A message sent mid-turn draws its echo after
   *  the running turn; counting it, the turn read as old and its Copy fell
   *  back under the running work (review of b935e72a7). */
  isNewest: boolean
  /** The rows of the turn that draw as the agent's reply (the rows that each
   *  carried their own Copy before it moved to the turn's end), oldest first. */
  replyRows: readonly NativeChatMessage[]
  /** Whether any of those rows has words, without the Markdown pass. */
  hasProse: boolean
  /** The reply row holding the turn's last words, if any row has words. While
   *  the work after those words still runs, the turn's actions hang under
   *  them, above that work, as the Claude app hangs its action row off the
   *  turn's last assistant message with text (see trailingWorkIsRunning). */
  proseEndId: string | undefined
  /** The tool calls and results drawn after the turn's last words, oldest
   *  first: the rest of that row and every later row of the turn. All of the
   *  turn's work when no row has words; empty when the turn ends on words. */
  trailingWork: readonly NativeChatBlock[]
}

const NO_ECHOES: ReadonlySet<string> = new Set()

const isWork = (block: NativeChatBlock): boolean => isToolCallBlock(block) || isToolResultBlock(block)
const hasWords = (block: NativeChatBlock): boolean => isTextBlock(block) && block.text.trim() !== ''

/** Where a turn's last words are and what work follows them. Over the blocks
 *  each row draws, so a roster's frozen sentence (#26125) is not words here
 *  either; a blank text is not words, as Claude's own test is non-blank. */
function lastWordsAndWorkAfter(replyRows: readonly NativeChatMessage[]): {
  proseEndId: string | undefined
  trailingWork: NativeChatBlock[]
} {
  const trailingWork: NativeChatBlock[] = []
  for (let index = replyRows.length - 1; index >= 0; index -= 1) {
    const row = replyRows[index]!
    const drawn = drawnNativeChatBlocks(row.blocks)
    const lastWords = drawn.findLastIndex(hasWords)
    trailingWork.unshift(...drawn.slice(lastWords + 1).filter(isWork))
    if (lastWords !== -1) {
      return { proseEndId: row.id, trailingWork }
    }
  }
  return { proseEndId: undefined, trailingWork }
}

/**
 * Whether the work after a turn's last words is still going, which keeps the
 * turn's actions under those words instead of under the work.
 *
 * The Claude app (com.anthropic.claude 1.261009.20) keys each turn's action
 * row (l330.a: "Copy message", "Read aloud", thumbs) to the later of two
 * records: the turn's last assistant message with non-blank text, and the
 * turn's `result` (rs8.w6, built by n030.k). Tool rows never move it. The
 * result arrives only when the turn is over, and moves the row to the end,
 * under the work. The phone's transcript has no result record, so "the turn
 * is over" is read from the work itself: the newest turn while the agent
 * works on it, or work its row draws as still running (toolRunProgress: an
 * agent or a background shell a source that will also retire it counts).
 * Only the newest turn's working state counts: an older turn's open call was
 * abandoned (review of b935e72a7).
 */
export function trailingWorkIsRunning(
  work: readonly NativeChatBlock[],
  { turnIsNewest, runs }: { turnIsNewest: boolean; runs: NativeChatAgentRunInputs }
): boolean {
  if (!work.some(isWork)) {
    return false
  }
  if (turnIsNewest && runs.agentWorking) {
    return true
  }
  const ownTurn = { ...runs, agentWorking: turnIsNewest && runs.agentWorking }
  return toolRunProgress(work, ownTurn, { inNewestReply: turnIsNewest }) !== null
}

/** Whether a row draws as the agent's reply and so can carry its actions:
 *  not a prompt, a thought, a host notice, an error row, the harness's words
 *  around a peer message or a subagent's message, which
 *  MobileNativeChatMessage draws without them. A system row whose hint this
 *  build does not know falls through to ordinary prose there, and does here
 *  too. */
function drawsAsReply(message: NativeChatMessage): boolean {
  if (message.role === 'user' || message.role === 'reasoning' || errorRowOf(message) !== null) {
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
 *  order, oldest first; `echoIds` names the rows that are the phone's own
 *  echoes of a sent message, not yet in the transcript. */
export function agentTurnsByEnd(
  messages: readonly NativeChatMessage[],
  echoIds: ReadonlySet<string> = NO_ECHOES
): Map<string, AgentTurn> {
  const turns = new Map<string, AgentTurn>()
  // The newest row that is not an echo: a turn at or past it is the newest.
  const lastTranscriptIndex = messages.findLastIndex((message) => !echoIds.has(message.id))
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
    // A row the harness's hidden user turn opened (a background task's notification) starts a
    // turn of its own, as the row of a prompt would.
    if (!next || !CARRIES_ON_A_TURN.has(next.role) || isHarnessTurnStart(next)) {
      const end = replyRows.at(-1)
      if (end) {
        turns.set(end.id, {
          isNewest: index >= lastTranscriptIndex,
          replyRows,
          // What the rows draw: a roster's frozen sentence is not on screen (#26125).
          hasProse: replyRows.some((row) => nativeChatMessageText(drawnNativeChatBlocks(row.blocks)) !== ''),
          ...lastWordsAndWorkAfter(replyRows)
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
