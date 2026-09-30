// ─── A queued message under a NAMED prompt rule, Claude Code 2.1.285 ─────────
//
// Reported 2026-09-30 (session 790eafa8, Claude Code 2.1.285): a message sent
// while Claude worked sat in its queue for 43 s (transcript: `queue-operation`
// enqueue 14:22:37.505Z, `queued_command` attachment, `remove` 14:23:20.110Z),
// and the phone's chat drew it as an ordinary sent bubble.
//
// PROVENANCE. Nothing here is a `tmux capture-pane`; it is transcribed.
//   FROM THE PHONE'S SCREENSHOT of the terminal view (the words, order, indent):
//     the marked row, the send-now row under it, the spinner, the rule that
//     carries the session's name at its right end ("paper-review", coloured by
//     /color: the transcript has an `agent-color` record), the composer with
//     its queue placeholder, the user's status lines, the footer.
//   FROM THE 2.1.285 BINARY (`strings`, read, never run): the send-now row is
//     `paddingLeft: 2`, dim, chord + "send now" (identical in 2.1.284); the
//     placeholder is "Press up to edit queued messages" (identical in 2.1.284);
//     the composer box takes `borderText` from the same code in both builds, so
//     the named rule is not new in 2.1.285 - it is a shape no fixture had.
//   NOT KNOWN, so not claimed: the exact bytes of the rule row (whether the
//     label has a trailing rule glyph or a trailing space, how many rule glyphs
//     precede it). Both are tried below. Blank rows are absent because Orca's
//     `terminal.read --screen` drops them. A live `tmux capture-pane -p` of a
//     renamed session with a queued message would settle the row's bytes.

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
const BELOW = [
  '[Opus 5.5 xhigh | Max 20x] █░░░░░░░░░ 21% (213k/1.0M) | hybrid_snn_ann git:(main* ?11)',
  '  accept edits on (shift+tab to cycle) · ← for agents'
]

/** The rule row as the screenshot shows it: rule glyphs, then the name. */
export const NAMED_RULES = {
  bare: '─'.repeat(70),
  labelAtEnd: '─'.repeat(58) + ' paper-review',
  labelAtEndTrailingSpace: '─'.repeat(58) + ' paper-review ',
  labelThenRule: '─'.repeat(58) + ' paper-review ─'
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
    '─'.repeat(70),
    ...BELOW
  ]
}

/** The same turn after Claude took the message: no queue, the placeholder gone. */
export function takenScreen2_1_285(rule: string): string[] {
  return [
    ...TOOL_ROWS_ABOVE,
    `❯ ${QUEUED_ROW_TEXT}`,
    SPINNER,
    rule,
    '❯',
    '─'.repeat(70),
    ...BELOW
  ]
}
