// ─── A queued message under a NAMED prompt rule, Claude Code 2.1.285 ─────────
//
// Reported 2026-09-30 (session 790eafa8, Claude Code 2.1.285): a message sent
// while Claude worked sat in its queue for 43 s (transcript: `queue-operation`
// enqueue 14:22:37.505Z, `queued_command` attachment, `remove` 14:23:20.110Z),
// and the phone's chat drew it as an ordinary sent bubble.
//
// PROVENANCE. Mixed: the queued layout is transcribed, the rule rows are captured.
//   FROM THE PHONE'S SCREENSHOT of the terminal view (the words, order, indent):
//     the marked row, the send-now row under it, the spinner, the rule that
//     carries the session's name at its right end ("paper-review", coloured by
//     /color: the transcript has an `agent-color` record), the composer with
//     its queue placeholder, the user's status lines, the footer.
//   FROM THE 2.1.285 BINARY (`strings`, read, never run): the send-now row is
//     `paddingLeft: 2`, dim, chord + "send now" (identical in 2.1.284); the
//     placeholder is "Press up to edit queued messages" (identical in 2.1.284);
//     the name comes from the banner row (`fv` in 2.1.285, `Ub` in 2.1.284) and
//     `borderText` carries the fast-mode and ultracode tags; both builds build
//     the row the same way, so the named rule is not new in 2.1.285 - it is a
//     shape no fixture had.
//   CAPTURED 2026-09-30 from Claude Code 2.1.285 via orca terminal read --screen
//     (a live session named "1152", no queued message on screen): the named
//     rule row (119 x "─", " 1152 ", ONE trailing "─": 126 columns, no trailing
//     space, directly above the composer), the plain 126-column rule under the
//     composer, the status line rows and the footer. Byte-exact. This pins the
//     rule shape; the earlier guesses at it (label at the end, trailing space)
//     are dropped. Blank rows are absent because Orca drops them. The queued
//     row, its send-now row, the spinner and the placeholder are NOT from that
//     capture (none was queued): they are the binary plus the screenshot.

export const QUEUED_ROW_TEXT = 'Can we finish the paper by today ask fable'

const TOOL_ROWS_ABOVE = [
  '  Submitting walk task 1 on the admin\'s slice · 39s',
  "  ⎿  $ ssh -o ConnectTimeout=15 willi bash -s <<'EOF'",
  '     cd /scratch/paulalwi/Master_Thesis/hybrid_snn_ann && sbatch',
  '     f=$(ls -t blade_revi… (40s · 2 lines)',
  '     (ctrl+b to run in background)'
]

const SPINNER = '* Manifesting… (1m 35s · ↓ 6.6k tokens)'
const COMPOSER = '❯ Press up to edit queued messages'

// captured 2026-09-30 from Claude Code 2.1.285 via orca terminal read --screen
const CAPTURED_BELOW = [
  '─'.repeat(126),
  '  [Opus 5.5 (1M context) xhigh | Team] ██████░░░░ 60% (604k/1.0M) | NexOS git:(feat/here-sdk-token-auth ↑1 ↓19) | 2 CLAUDE.…',
  '  Weekly ███████░░░ 65% · Fable █░░░░░░░░░ 12% (resets Sat 2:59 AM)',
  '  ' + '─'.repeat(121) + '…',
  '  ✓ Bash ×19 | ✓ Write ×1',
  '  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents'
]

export const NAMED_RULES = {
  /** captured 2026-09-30 from Claude Code 2.1.285 via orca terminal read --screen */
  captured1152: '─'.repeat(119) + ' 1152 ─',
  /** What 2.1.284 and older draw (existing fixtures); kept as the control. */
  bare: '─'.repeat(126)
} as const

/** The 2.1.285 screen: the queued row directly under a running tool's rows. */
export function queuedScreen2_1_285(rule: string): string[] {
  return [
    ...TOOL_ROWS_ABOVE,
    `❯ ${QUEUED_ROW_TEXT}`,
    '  ctrl+enter to send now',
    SPINNER,
    rule,
    COMPOSER,
    ...CAPTURED_BELOW
  ]
}

/** The same turn after Claude took the message: no queue, the placeholder gone. */
export function takenScreen2_1_285(rule: string): string[] {
  return [...TOOL_ROWS_ABOVE, `❯ ${QUEUED_ROW_TEXT}`, SPINNER, rule, '❯', ...CAPTURED_BELOW]
}
