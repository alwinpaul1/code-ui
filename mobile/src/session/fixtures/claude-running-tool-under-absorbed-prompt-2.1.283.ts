// ─── A running tool under an absorbed prompt, with a message queued ──────────
//
// Claude Code 2.1.283, session 790eafa8 on this machine, 2026-09-27 around
// 10:20 local, a tab driven from the phone. The phone sent "Also can media
// files above q8mb like screen recording be send" mid-turn; Claude took it and
// ran a shell command about it; the phone then queued a second message with
// two photos. The chat drew the first message once, correctly, and later a
// SECOND user bubble reading that message, the tool's description line and
// its `⎿ $ …` row, joined by line breaks.
//
// The rows, and where each comes from:
//
// - The terminal was 98 columns. Measured from the user's screenshot of it:
//   the assistant's rows wrap at 96 characters after the 2-column dot, and
//   the queued message's first row (94 characters) breaks before "but".
// - The agent's reply above the prompt, the prompt row, and the queued
//   message's two rows are transcribed from that screenshot.
// - The running group's rows are constructed from the 2.1.283 painter, read
//   in the binary's strings (cc2183-strings.txt), because no agent could be
//   run to capture them:
//     • the dot is `Fr`, "⏺" on macOS, drawn by `Bo` in a `minWidth:2` box as
//       `!shouldAnimate || on || isError || !isUnresolved ? Fr : " "`, with
//       `on` flipping every 600 ms (`UC=600`). The active group passes
//       `shouldAnimate: true, isUnresolved: true`, so on its OFF frame the
//       row starts with two spaces, the same as a wrapped line of a prompt;
//     • the description is the group's task summary, and the hint under it
//       is a row of its own, painted only when there is a hint: a width-5
//       box holding "  ⎿  ", then the hint in a column, word-wrapped by Ink,
//       so its wrapped lines start at column 5. The hint text is the user's
//       report; its break points come from wrap-ansi 7 at 93 columns
//       (98 − 5), not from a capture;
//     • a finished group draws an empty `minWidth:2` box instead of the dot,
//       which is why "  Ran 6 shell commands" has no glyph at all.
// - The queue (`r6e`) sits right under the transcript and above the spinner,
//   each entry drawn by the user-prompt painter: "❯ " beside a text column,
//   so its wrapped lines start at two spaces, closed by "ctrl+enter to send
//   now" at two spaces.
//
// What the phone receives is NOT what the desktop paints. Claude puts a blank
// row above the group and above the first queued entry (`marginTop`), but
// Orca 1.4.212 builds `terminal.read --screen` with
//   lines.map((l) => l.trimEnd()).filter((l) => l.trim().length > 0)
// (`Dxa` in its main bundle), so every blank row is gone and every row is
// trimmed at the end. The rows below are in that form. With the blank rows
// gone, only the tool's own rows separate the prompt above from the queue
// below: its dot, which the OFF frame leaves out, and the `⎿` row at two
// spaces, which the reader now stops at.

export const COLUMNS = 98
export const SEPARATOR = '─'.repeat(COLUMNS)

export const ABSORBED_PROMPT = 'Also can media files above q8mb like screen recording be send'
export const TOOL_DESCRIPTION = "Checking the recording's size and the upload RPC"

/** The queued photo send, as the queue box paints it and the reader joins it. */
export const QUEUED_PHOTO_SEND =
  "[Image #111] [Image #112] Also why like there are responses below this prompt in terminal mode\nbut chatui doesn't show that"

/** The agent's reply above the prompt: its dot row, then two-space rows. */
export const REPLY_ABOVE = [
  '⏺ The save-picker fix needs one more round. If a picker never returns, rare but possible, every',
  "  later save would now wait forever behind a dead button. Before, you'd at least get an error. The",
  '  fix will cancel a waiting save straight away when you leave it, and free the queue once the app',
  '  is back in front with no picker showing.',
  '  Still running: the tasks-sheet drag fix and the last permission items. The APK built from main',
  '  is still waiting for the phone.',
  '  session:ok'
] as const

export const PROMPT_ROW = `❯ ${ABSORBED_PROMPT}`

export const HINT_ROWS = [
  '  ⎿  $ ls -la /private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Code-UI/790eafa8-07b2-4380-',
  '     abc2-90e22f965369/scratchpad/rec-sheet/rec.mp4; cd "/Users/alwinpaul/Desktop/Project/Code',
  '     UI/mobile/src" && grep -n "CLIPBOARD_IMAGE_TOO_LARGE_ERROR\\|MAX_BASE64\\|24 \\* 1024"',
  '     session/mobile-clipboard-image.t…'
] as const

export const QUEUED_ROWS = [
  '❯ [Image #111] [Image #112] Also why like there are responses below this prompt in terminal mode',
  "  but chatui doesn't show that",
  '  ctrl+enter to send now'
] as const

/** Everything under the queue: the spinner, the composer Orca emptied, and
 *  the user's status line. The composer's placeholder reaches the phone as
 *  the draft, `QUEUE_DRAFT`. */
export const BELOW_QUEUE = [
  '✻ Proofing… (1m 33s · ↓ 7.1k tokens)',
  SEPARATOR,
  '❯',
  SEPARATOR,
  '  [Opus 5.5 xhigh | Max 20x] ███░░ 58% (577k/1.0M) | src git:(main ↑359) | 1 CLAUDE.md',
  '  Usage █░░░░ 11% (resets 1:40 PM) | Weekly ███░░ 57% · Fable ░░░░░ 8% (resets Wed 6:59 PM)',
  '  ✓ Bash ×14 | ✓ SendMessage ×4 | ✓ Read ×2',
  '  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents'
] as const

export const QUEUE_DRAFT = 'Press up to edit queued messages'

/** The screen the phone reads while the command runs, on the dot's ON or OFF
 *  frame. The phone polls about once a second and the dot flips every 600 ms,
 *  so it reads both. */
export function runningToolFrame(dot: 'on' | 'off'): string[] {
  return [
    ...REPLY_ABOVE,
    PROMPT_ROW,
    `${dot === 'on' ? '⏺' : ' '} ${TOOL_DESCRIPTION}`,
    ...HINT_ROWS,
    ...QUEUED_ROWS,
    ...BELOW_QUEUE
  ]
}

/** The text the second bubble carried: the reader took the prompt row as a
 *  queued entry and joined the tool's rows onto it, each trimmed. */
export const LEAKED_BUBBLE_TEXT = [ABSORBED_PROMPT, TOOL_DESCRIPTION, ...HINT_ROWS.map((row) => row.trim())].join('\n')
