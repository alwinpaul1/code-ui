// ─── Codex screens that show, or do not show, its composer ───────────────────
//
// PROVENANCE. Every screen below marked REAL is pasted verbatim from a test
// that already holds it; none was typed for this file.
//
//   Codex 0.158.0, REAL bytes (Orca 1.4.217 runtime fixtures, 120x40, launched
//   as `codex --no-daemon -c check_for_update_on_startup=false
//   --dangerously-bypass-approvals-and-sandbox`) rendered through tmux:
//   IDLE_AFTER_TURN_0158, WORKING_0158, APPROVAL_0158, TRUST_PROMPT_0158 (from
//   codex-0158-screens.test.ts) and QUOTED_IN_ANSWER_0158 (Orca's own
//   codex-quiet-ready-screen.test.ts, v1.4.217, pasted there verbatim).
//   Codex 0.155.1, REAL: WORKING_0155 (same file, mid-turn).
//
//   Codex 0.153.4 (the build installed on this machine), REAL: LIVE_0153_S23 is
//   the bottom of a live Galaxy S23 session (2026-09-09, `orca terminal show`,
//   pasted from mobile-terminal-hud-parse.test.ts), a four-row excerpt; and the
//   /model and effort PICKER steps from codex-picker-screen.test.ts (`orca
//   terminal read --screen`, 2026-09-05). There is no full-screen capture of a
//   0.153.4 composer, and none with a slash or `@` popup open.
//
//   MODELLED, not captured: the popup screens (POPUP_BELOW_COMPOSER: 0.153.4 draws
//   it below the composer with no `›` of its own, POPUP_ABOVE_COMPOSER: 0.158
//   draws it above, both from codex-queue-under-an-open-popup.test.ts, which
//   built them from rust snapshots), every `*_EXITED_*` screen (what a shell shows
//   after Codex exits: the old frame, Codex's "Token usage" and resume lines
//   from the 0.153.4 binary's strings, then a prompt) and the context-left
//   footer (composed from rust-v0.158.0 snapshots in
//   codex-queue-under-an-open-popup.test.ts, not a tmux capture). A capture of
//   Codex exiting to a shell is STILL MISSING: whether its last frame stays on
//   screen, and what it prints under it, is not known.
//
// Orca 1.4.212 and later drop blank rows from `terminal.read --screen`
// (mobile-terminal-queue-block.ts), so the phone reads these without them;
// `withoutBlankRows` makes that form.

export const withoutBlankRows = (lines: readonly string[]): string[] =>
  lines.filter((row) => row.trim() !== '')

// Codex 0.158.0, after a turn: the footer carries the thread title as a third field.
export const IDLE_AFTER_TURN_0158 = [
  '',
  '  >_ OpenAI Codex (v0.158.0)',
  '     ~/orca-lanes/sta8834/corpus/scratch',
  '  permissions: YOLO mode',
  '',
  '  Shall we see where this goes?',
  '',
  '',
  '› List the files here and summarize in 2 bullets.',
  '',
  '',
  '• I’ll inspect the directory contents and summarize what’s present in two bullets.',
  '',
  '• Explored',
  "  └ List rg --files -g '*' -g '.*'",
  '    Read README.md, notes.txt',
  '    + Show details',
  '',
  '• • README.md — contains the heading “scratch.”',
  '  • notes.txt — contains the text “hello.”',
  '',
  '  9:46 PM',
  '',
  '',
  '› Ask Codex to do anything',
  '',
  '  GPT-6-Sol medium · ~/orca-lanes/sta8834/corpus/scratch · List and summarize files',
  '  ? for shortcuts'
]

// Codex 0.158.0, mid-turn, the composer still showing its placeholder.
export const WORKING_0158 = [
  '',
  '  >_ OpenAI Codex (v0.158.0)',
  '     ~/orca-lanes/sta8834/corpus/scratch',
  '  permissions: YOLO mode',
  '',
  '  Shall we see where this goes?',
  '',
  '',
  '› List the files here and summarize in 2 bullets.',
  '',
  '',
  '• Working (0s • esc to interrupt)',
  '',
  '',
  '› Ask Codex to do anything',
  '',
  '  GPT-6-Sol medium · ~/orca-lanes/sta8834/corpus/scratch',
  '  ? for shortcuts'
]

// Codex 0.158.0 idle under an answer that quotes the busy row.
export const QUOTED_IN_ANSWER_0158 = [
  '>_ OpenAI Codex (v0.158.0)',
  '   ~/repo',
  '',
  '› what does the status row look like mid-turn?',
  '',
  '• It reads like this:',
  '',
  '  • Working (0s • esc to interrupt)',
  '',
  '  The timer counts up until the turn ends, and the row',
  '  disappears once the answer is complete.',
  '',
  '› Ask Codex to do anything',
  '',
  '  gpt-5.6-sol medium · ~/repo',
  '  ? for shortcuts'
]

// Codex 0.155.1, mid-turn: no `? for shortcuts`, the footer is the last row.
export const WORKING_0155 = [
  '╭──────────────────────────────────────────────────╮',
  '│ >_ OpenAI Codex (v0.155.1)                       │',
  '│                                                  │',
  '│ model:       gpt-6-sol medium   /model to change │',
  '│ directory:   ~/orca-lanes/sta8834/corpus/scratch │',
  '│ permissions: YOLO mode                           │',
  '╰──────────────────────────────────────────────────╯',
  '',
  '  Tip: New Use /fast to enable our fastest inference with increased plan usage.',
  '',
  '• You have 3 usage limit resets available. Run /usage to use one.',
  '',
  '',
  '› List the files here and summarize in 2 bullets.',
  '',
  '',
  '• Working (3s • esc to interrupt)',
  '',
  '',
  '› Ask Codex to do anything',
  '',
  '  gpt-6-sol medium · ~/orca-lanes/sta8834/corpus/scratch · renaming... ⠙'
]

// Codex 0.158.0 command approval: the selected option is drawn with the composer's own `› `.
export const APPROVAL_0158 = [
  '',
  '  >_ OpenAI Codex (v0.158.0)',
  '     ~/orca-lanes/sta8834/corpus/scratch',
  '',
  '  All right. What have you got?',
  '',
  '',
  '› Run `touch approved.txt`.',
  '',
  '',
  '• I’ll create the file in the current workspace; this requires write access beyond the read-only sandbox.',
  '',
  '• Running touch approved.txt',
  '',
  '',
  '  Would you like to run the following command?',
  '',
  '  Environment: local',
  '',
  '  Reason: May I create approved.txt in the current workspace as requested?',
  '',
  '  $ touch approved.txt',
  '',
  '',
  '› 1. Yes, proceed (y)',
  "  2. Yes, and don't ask again for commands that start with `touch approved.txt` (p)",
  '  3. No, and tell Codex what to do differently (esc)',
  '',
  '  Press enter to confirm or esc to cancel'
]

// Codex 0.158.0's first-launch folder trust prompt.
export const TRUST_PROMPT_0158 = [
  '',
  '  Folder access',
  '  /Users/xxxxxx/orca-lanes/sta8834/corpus/scratch',
  '',
  '  Trust this folder? Codex can read, edit, and run files here, subject to your permission settings. Folder settings',
  '  can run code automatically, even without a model request. Continue only if you trust these files. Your trust',
  '  decision will be saved.',
  '',
  '› 1. Trust and continue',
  '  2. Quit',
  '',
  '  enter continue · esc quit'
]

/** Codex 0.158.0 before its composer exists: the startup banner and `loading`. */
export const STARTING_0158 = [
  '',
  '  >_ OpenAI Codex (v0.158.0)',
  '     loading',
  '',
  '  Shall we see where this goes?'
]

/** MODELLED. A footer with no model or directory (`tui.status_line` set to the
 *  context item, or the default hint row), composed from rust-v0.158.0 snapshots. */
export const CONTEXT_LEFT_FOOTER = ['› Ask Codex to do anything', '', '  tab to queue message                   100% context left']

/** MODELLED. The shell prompts the Claude exit fixture also uses, here under
 *  Codex's last frame, preceded by the lines Codex's binary says it prints on
 *  exit (`Token usage: total=`, `To continue this session, run codex resume`). */
export const CODEX_EXITED_PROMPTS = {
  zsh: '66% ',
  bash: 'bash-3.2$ ',
  /** A column-0 prompt that is shaped like Codex's footer apart from its indent. */
  footerShaped: 'x-y · ~/proj'
} as const

export const codexExitedToShell = (
  frame: readonly string[],
  prompt: string,
  withExitLines = true
): string[] => [
  ...frame,
  ...(withExitLines
    ? [
        'Token usage: total=1,234 input=1,000 (+ 5,000 cached) output=234',
        'To continue this session, run codex resume 019a-modelled'
      ]
    : []),
  prompt
]

/** MODELLED. Codex's frame gone and only a shell left. */
export const plainShellScreen = (prompt: string): string[] => ['hi', prompt]

/** Codex 0.153.4, REAL: the bottom of a live Galaxy S23 session, 2026-09-09
 *  (excerpt as pasted in mobile-terminal-hud-parse.test.ts). */
export const LIVE_0153_S23 = [
  '› Reply with the single word ready.   tab to queue message',
  '                                                                        100% context left',
  '› Reply with the single word ready.',
  '  gpt-5.6-terra xhigh · ~/Desktop/Project/Code UI'
]

/** Codex 0.153.4, REAL (`orca terminal read --screen`, 2026-09-05): the /model
 *  picker, whose selected row wears the composer's `›`. */
export const MODEL_PICKER_0153 = [
  '│  Weekly limit:                [████████████████████] 100% left (resets 17:16 on 12 Sep) │',
  '╰─────────────────────────────────────────────────────────────────────────────────────────╯',
  '  Select Model and Effort',
  '  Access legacy models by running codex -m <model_name> or in your config.toml',
  '  1. gpt-6-astra (default)  Our most capable model for complex, demanding work.',
  '› 2. gpt-5.6-sol (current)  Reliable agentic workhorse for everyday tasks.',
  '  3. gpt-5.6-terra          Balanced agentic coding model for everyday work.',
  '  Press enter to confirm or esc to go back'
]

/** MODELLED. A picker whose selected row is NOT numbered, with its key hint
 *  (the hint wording is the real 0.153.4 picker's). */
export const UNNUMBERED_PICKER = [
  '• Done.',
  '  Resume a previous session',
  '› Today  fix the build',
  '  Yesterday  review the diff',
  '  Press enter to confirm or esc to go back'
]

/** MODELLED. Codex 0.153.4's slash popup, BELOW the composer, no `›` of its own. */
export const POPUP_BELOW_COMPOSER = [
  '• Done.',
  '› /mo',
  '  /model     choose what model and reasoning effort to use',
  '  /memories  configure memory use and generation'
]

/** MODELLED. Codex 0.158's slash popup, ABOVE the composer, its selected row
 *  wearing `›` too, the footer under the composer. */
export const POPUP_ABOVE_COMPOSER = [
  '• Working (12s • esc to interrupt)',
  '› /resume  resume a saved chat',
  '› /res',
  '  tab to queue message                   100% context left'
]
