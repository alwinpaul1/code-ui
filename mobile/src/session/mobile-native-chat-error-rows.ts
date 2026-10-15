import { isInterruptedStatusMessage, type NativeChatMessage } from '../../../src/shared/native-chat-types'

/** The Claude app's words for a turn the user stopped: its `result` row with
 *  subtype `error_during_execution` reads "Session interrupted" (1.261009.20). */
export const SESSION_INTERRUPTED_TEXT = 'Session interrupted'

/**
 * The words of a row drawn as an error rather than as the agent speaking, or
 * null for any other row: only the status row Orca's decoders write for a
 * stopped turn (Claude Code's `interruptedMessageId` record, Codex's
 * `turn_aborted`), in the Claude app's words. A matched Claude tab never has
 * one: the app draws nothing after Stop, and its decoder writes none
 * (ccr-transcript-decode.ts).
 *
 * A Claude Code API error is the agent's plain words, as the Claude app draws
 * it (1.261013.20: an assistant item, no error styling; `nx30.f` rewords only
 * `claude_code_version_too_old`). It was a red row here from 2026-10-12 to
 * 2026-10-15.
 */
export function errorRowOf(message: NativeChatMessage): { text: string } | null {
  return isInterruptedStatusMessage(message) ? { text: SESSION_INTERRUPTED_TEXT } : null
}
