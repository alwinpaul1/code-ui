import {
  AGENT_TUI_CLEAR_LINE_SLACK,
  buildAgentTuiClearInput
} from '../../../src/shared/agent-tui-input-clear'

/**
 * The narrowest input the phone will ever put an agent in: `measure` refuses
 * anything under 20 columns. Counting wrapped lines at this width overshoots on
 * every real terminal, and overshoot is free (see AGENT_TUI_CLEAR_LINE_SLACK).
 */
export const MOBILE_NATIVE_CHAT_CLEAR_MIN_COLS = 20

/**
 * Clear bytes for an agent input believed to hold `text`, counting VISUAL lines.
 *
 * Why not the shared `buildAgentTuiClearInputForText`: it counts logical lines,
 * and Claude Code's Ctrl+U clears one visual line — verified against 2.1.266 on
 * 2026-09-09, where a single Ctrl+U on a four-line wrapped message removed only
 * " skill to write". The draft mirror had typed that message onto the line, so
 * the send's single Ctrl+U left most of it standing and the body was typed
 * after it: the transcript received the message glued onto its own residue.
 * A 17× Ctrl+U + 17× Ctrl+K burst emptied a six-visual-line input cleanly.
 */
export function buildMobileNativeChatClearInputForText(
  ...texts: readonly (string | null | undefined)[]
): string {
  // Why the max over candidates: the phone knows several things that may be on
  // the line (a parked launch draft, a queue-edit residue, the mirrored draft)
  // and cannot tell which one the agent actually holds. Size for the tallest.
  let visualLines = 1
  for (const text of texts) {
    if (!text) {
      continue
    }
    let lines = 0
    for (const line of text.split(/\r\n|\r|\n/)) {
      lines += Math.max(1, Math.ceil(Array.from(line).length / MOBILE_NATIVE_CHAT_CLEAR_MIN_COLS))
    }
    visualLines = Math.max(visualLines, lines)
  }
  return buildAgentTuiClearInput(visualLines + AGENT_TUI_CLEAR_LINE_SLACK)
}
