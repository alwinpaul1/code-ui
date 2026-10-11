// ─── A queued message, before and after the agent's own recall key ───────────
//
// CAPTURED 2026-10-11 with `tmux capture-pane -p` from live agents in a 100 x 40
// pane, for tap-to-edit on the phone's queue box
// (queued-message-tap-to-composer.test.ts). Blank rows are dropped and trailing
// spaces trimmed, as Orca's `terminal.read` tail does; nothing else is changed.
//
// ONE SPLICE in the queued screens: above the queue the capture held the
// numbers the agent was streaming, two columns in, back past the 60-row window,
// and with the blank row over the queue dropped (as Orca drops it) the reader
// cannot tell them from an older entry's wrapped lines and refuses the box, as
// designed (mobile-terminal-queue-block.ts). The queued screens therefore start
// with the running tool's rows from the 2.1.285 fixture (claude-queued-named-
// rule-2.1.285.ts, transcribed from a screenshot), which bound the box there.
// Everything from the first queued row down is this capture.
//
// Claude Code 2.1.296, stock (no CLAUDE_CODE_KB_COHESION_FIXES): one Up pulls the
// WHOLE queue into the input. With one message queued that is the message; with
// two it is both, one per line (the second capture pair). The send-now row reads
// "ctrl+x ctrl+s to send now" on this build (2.1.285 drew "ctrl+enter").
//
// Codex 0.153.4 in tmux: the hint reads "shift + ← edit last queued message",
// not "alt + ↑"; Alt+Up (ESC [1;3A) still recalled the message, which is the
// key the phone sends. The banner rows are the user's own Codex config.

import { TOOL_ROWS_ABOVE } from './claude-queued-named-rule-2.1.285'

const CLAUDE_RULE = '─'.repeat(100)
const CLAUDE_STATUS = [
  ' '.repeat(96) + '[-]',
  '  Opus 5.5 medium │ ◔ 6%   ◷ 5h 88% │ Mon 12:00 AM   ▦ 7d 31% │ Wed 7:00 PM'
]

export const CLAUDE_2_1_296_VERSION = 'Claude Code 2.1.296'
export const CODEX_0_153_4_VERSION = 'Codex 0.153.4'

export const CLAUDE_QUEUED_TEXT = 'then also say goodbye in French'

/** Working, one message queued. Orca's `draft` is the placeholder here. */
export const CLAUDE_ONE_QUEUED_2_1_296 = [
  ...TOOL_ROWS_ABOVE,
  `❯ ${CLAUDE_QUEUED_TEXT}`,
  '  ctrl+x ctrl+s to send now',
  ...CLAUDE_STATUS,
  CLAUDE_RULE,
  '❯ Press up to edit queued messages',
  CLAUDE_RULE,
  '  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents'
]

/** After one Up: the queue is gone and the message is in the input. */
export const CLAUDE_ONE_RECALLED_2_1_296 = [
  '  one hundred ninety-eight',
  ...CLAUDE_STATUS,
  CLAUDE_RULE,
  `❯ ${CLAUDE_QUEUED_TEXT}`,
  CLAUDE_RULE,
  '  ⏵⏵ auto mode on (shift+tab to cycle)'
]

export const CLAUDE_TWO_QUEUED_TEXTS = ['alpha first queued', 'bravo second queued'] as const

export const CLAUDE_TWO_QUEUED_2_1_296 = [
  ...TOOL_ROWS_ABOVE,
  `❯ ${CLAUDE_TWO_QUEUED_TEXTS[0]}`,
  `❯ ${CLAUDE_TWO_QUEUED_TEXTS[1]}`,
  '  ctrl+x ctrl+s to send now',
  ...CLAUDE_STATUS,
  CLAUDE_RULE,
  '❯ Press up to edit queued messages',
  CLAUDE_RULE,
  '  cache ● 1h ██████ 59m left · hit 44% · misses 0',
  '  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents'
]

/** After one Up on the stock build: both messages in the input, one per line. */
export const CLAUDE_TWO_RECALLED_2_1_296 = [
  ...CLAUDE_STATUS,
  ' '.repeat(73) + 'ctrl+g to edit in VS Code',
  CLAUDE_RULE,
  `❯ ${CLAUDE_TWO_QUEUED_TEXTS[0]}`,
  `  ${CLAUDE_TWO_QUEUED_TEXTS[1]}`,
  CLAUDE_RULE,
  '  cache ● 1h ██████ 59m left · hit 44% · misses 0',
  '  ⏵⏵ auto mode on (shift+tab to cycle)'
]

export const CODEX_QUEUED_TEXT = 'then also say goodbye in French'

/** Working, one follow-up queued with Tab. */
export const CODEX_ONE_QUEUED_0_153_4 = [
  '• Working (4s • esc to interrupt)',
  '• Queued follow-up inputs',
  `  ↳ ${CODEX_QUEUED_TEXT}`,
  '    shift + ← edit last queued message',
  '› Ask Codex to do anything',
  '  gpt-5.6-terra xhigh · ~/Desktop/Project/Code UI'
]

/** After Alt+Up: the follow-up is in the composer and the preview is gone. */
export const CODEX_ONE_RECALLED_0_153_4 = [
  '  one hundred ten',
  `› ${CODEX_QUEUED_TEXT}`,
  '  tab to queue message' + ' '.repeat(59) + '100% context left'
]
