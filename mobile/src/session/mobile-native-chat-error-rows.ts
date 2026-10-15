import { isInterruptedStatusMessage, type NativeChatMessage } from '../../../src/shared/native-chat-types'

/** The Claude app's words for a turn the user stopped: its `result` row with
 *  subtype `error_during_execution` reads "Session interrupted" (1.261009.20). */
export const SESSION_INTERRUPTED_TEXT = 'Session interrupted'

/**
 * The words of a row drawn as an error rather than as the agent speaking, or
 * null for any other row: only the status row Orca's decoders write for a
 * stopped turn (Claude Code's `interruptedMessageId` record, Codex's
 * `turn_aborted`), in the Claude app's words. Only Codex draws it: the Claude
 * app draws nothing after Stop, so a matched Claude tab's decoder writes none
 * (ccr-transcript-decode.ts) and a Claude tab Orca reads keeps Orca's in its
 * list, where it ends the turn, but draws nothing for it (drawsStoppedTurnRow).
 *
 * A Claude Code API error is the agent's plain words, as the Claude app draws
 * it (1.261013.20: an assistant item, no error styling; `nx30.f` rewords only
 * `claude_code_version_too_old`). It was a red row here from 2026-10-12 to
 * 2026-10-15.
 */
/** Whether a tab of `agent` draws anything for this row. A Claude tab draws
 *  nothing for the stopped-turn row Orca's decoder writes, as the Claude app
 *  draws nothing after Stop (1.261013.20: `u5a.j`, `t5v`, `gy30`). The row
 *  stays in the list, where it still ends the turn before it
 *  (mobile-native-chat-turn-end.ts); only its drawing goes. Codex, and a tab
 *  whose agent is not known, draw it. */
export function drawsStoppedTurnRow(message: NativeChatMessage, agent: string | null | undefined): boolean {
  return agent !== 'claude' || !isInterruptedStatusMessage(message)
}

export function errorRowOf(message: NativeChatMessage): { text: string } | null {
  return isInterruptedStatusMessage(message) ? { text: SESSION_INTERRUPTED_TEXT } : null
}
