import {
  AGENT_TUI_CLEAR_LINE_SLACK,
  buildAgentTuiClearInput
} from '../../../src/shared/agent-tui-input-clear'
import { AGENT_TUI_MAX_KEY_WRITE_BYTES } from './agent-tui-clear-write-chunks'

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

/**
 * Most input rows ONE clear write can cover and still be read as keys.
 *
 * Claude Code turns a control byte into its own key only when the whole stdin
 * READ is under 64 bytes (`a.length<64||u===WZ.BS` in the 2.1.286 and 2.1.287
 * input tokenizer). The limit is per READ, not per write: writes made back to
 * back arrive as one read, so cutting a longer burst into writes of 63 does not
 * help, and a control byte that coalesces with the body is text too once the coalesced read reaches 64 bytes (a short clear and a short body are still keys). The
 * burst for `n` rows is 4n - 2 bytes (`buildAgentTuiClearInput`), so 16 rows is
 * the most that stays under 64 (62 bytes).
 */
export const MOBILE_NATIVE_CHAT_CLEAR_MAX_ROWS = 16

/** Rows past the ones counted on the screen: the input can wrap one more row
 *  between the look and the keys. Small, because it eats the 16. */
export const MOBILE_NATIVE_CHAT_SCREEN_CLEAR_SLACK = 2

/**
 * The clear for an input the screen shows taking `rows` rows: ONE write, under
 * 64 bytes whatever `rows` is. A taller input gets the most one write can do
 * (the caller reads back and clears again, then gives up); no rows, no bytes.
 */
export function buildScreenSizedClearInput(rows: number): string {
  if (!(rows >= 1)) {
    return ''
  }
  return buildAgentTuiClearInput(
    Math.min(
      Math.ceil(rows) + MOBILE_NATIVE_CHAT_SCREEN_CLEAR_SLACK,
      MOBILE_NATIVE_CHAT_CLEAR_MAX_ROWS
    )
  )
}

/**
 * The text-sized clear (above) for a send whose screen cannot be read, held to
 * one read: the same bytes while they fit, and the tallest single write when
 * they do not. Splitting a longer burst into writes was the 2026-10-01 defect.
 * Unverified: nothing reads back whether it emptied the input.
 */
export function buildMobileNativeChatClearInputOneRead(
  ...texts: readonly (string | null | undefined)[]
): string {
  const clearInput = buildMobileNativeChatClearInputForText(...texts)
  return clearInput.length < AGENT_TUI_MAX_KEY_WRITE_BYTES
    ? clearInput
    : buildAgentTuiClearInput(MOBILE_NATIVE_CHAT_CLEAR_MAX_ROWS)
}
