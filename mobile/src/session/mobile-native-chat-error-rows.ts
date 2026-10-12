import { isInterruptedStatusMessage, isTextBlock, type NativeChatMessage } from '../../../src/shared/native-chat-types'
import { isClaudeApiErrorText } from './claude-api-error-text'

/** The Claude app's words for a turn the user stopped: its `result` row with
 *  subtype `error_during_execution` reads "Session interrupted" (1.261009.20). */
export const SESSION_INTERRUPTED_TEXT = 'Session interrupted'

/**
 * The words of a row the Claude app draws as an error rather than as the
 * agent speaking, or null for any other row.
 *
 * - A stopped turn: the status row Orca's decoders write for Claude Code's
 *   `interruptedMessageId` record and Codex's `turn_aborted`, in the Claude
 *   app's words.
 * - A Claude Code API error: an assistant record holding nothing but the
 *   error's one line (claude-api-error-text.ts knows the shapes; every one
 *   recorded on this machine, 2.1.222 to 2.1.295, is a single line). One
 *   that goes on past it, carries tool work, or has a second text stays
 *   prose: that is the agent talking, and refusing costs only the colour.
 */
export function errorRowOf(message: NativeChatMessage): { text: string } | null {
  if (isInterruptedStatusMessage(message)) {
    return { text: SESSION_INTERRUPTED_TEXT }
  }
  if (message.role !== 'assistant' || message.blocks.length !== 1) {
    return null
  }
  const block = message.blocks[0]!
  if (!isTextBlock(block)) {
    return null
  }
  const text = block.text.trim()
  return text !== '' && !text.includes('\n') && isClaudeApiErrorText(text) ? { text } : null
}
