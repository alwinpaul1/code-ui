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
 *   error's words (claude-api-error-text.ts knows the shapes). One that also
 *   carries tool work, or a second text, stays prose: that is not the shape
 *   Claude Code writes, and refusing costs only the colour.
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
  return text !== '' && isClaudeApiErrorText(text) ? { text } : null
}
