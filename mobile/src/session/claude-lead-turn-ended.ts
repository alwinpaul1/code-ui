import { normalizeOptionalMultilineField } from '../../../src/shared/agent-status-field-normalization'
import {
  AGENT_STATUS_ASSISTANT_MESSAGE_MAX_LENGTH,
  type AgentStatusEntry
} from '../../../src/shared/agent-status-types'
import { isTextBlock, type NativeChatMessage } from '../../../src/shared/native-chat-types'
import { isClaudeApiErrorText } from './claude-api-error-text'

/**
 * Whether Claude Code's LEAD turn is over, read from the transcript, while
 * Orca may still report the pane `working`.
 *
 * Orca holds a Claude pane `working` after the lead's own Stop or StopFailure
 * for as long as a subagent or teammate it tracks is working, and, unlike a
 * background shell or a cron, it gives that state no `monitoring` mode
 * (`resolveClaudePaneStatus`, vendored claude-roster-state.ts). The status
 * alone cannot tell "the lead is working" from "the lead has answered and an
 * agent runs in the background", so the chat drew Working and Stop under a
 * finished turn (docs/claude-app-parity.md item 7). The Claude app shows the
 * turn ended, with the agent on its running-tasks row.
 *
 * The turn is over when the newest row the lead wrote, with nothing after it,
 * is one of these:
 *
 * - An API error. Claude Code 2.1.281's query loop returns `api_error` on one
 *   and fires StopFailure, never Stop; only a new prompt, notification or
 *   hand-back starts the next turn.
 * - The reply the host says Claude's Stop hook reported. Only a Stop sets a
 *   Claude pane's `lastAssistantMessage` to prose (tool events set tool output
 *   and flag it; a new prompt clears it), and the host keeps it folded and cut
 *   by `normalizeOptionalMultilineField`, so the row is compared the same way.
 *   Prose with no such report is not an end: the lead writes a note, then its
 *   next tool call.
 *
 * Host rows (role `system`) after it are skipped, because they never continue a
 * turn. Any other row after it (a prompt, a tool result, reasoning) means the
 * lead has gone on. A turn the lead starts with no row the phone sees, such as
 * a hand-back Orca's reader drops, reads as ended until its first row lands;
 * with no child running the desktop shows that pane `done` in the same window.
 * Claude only: the error shapes and the Stop field are Claude Code's.
 */
export function claudeLeadTurnEnded(
  agent: string | null,
  messages: readonly NativeChatMessage[],
  status: Pick<AgentStatusEntry, 'lastAssistantMessage' | 'lastAssistantMessageIsToolOutput'> | null | undefined
): boolean {
  if (agent !== 'claude') {
    return false
  }
  let index = messages.length - 1
  while (index >= 0 && messages[index]!.role === 'system') {
    index -= 1
  }
  const newest = messages[index]
  if (!newest || newest.role !== 'assistant' || !newest.blocks.every(isTextBlock)) {
    return false
  }
  // Joined as Claude Code joins a record's text blocks for `last_assistant_message`.
  const text = newest.blocks.map((block) => (isTextBlock(block) ? block.text : '')).join('\n')
  if (isClaudeApiErrorText(text.trim())) {
    return true
  }
  const reported = status?.lastAssistantMessageIsToolOutput === true ? undefined : status?.lastAssistantMessage
  return (
    reported !== undefined &&
    normalizeOptionalMultilineField(text, AGENT_STATUS_ASSISTANT_MESSAGE_MAX_LENGTH) === reported
  )
}
