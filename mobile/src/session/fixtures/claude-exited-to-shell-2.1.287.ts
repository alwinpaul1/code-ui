// ─── Claude exited back to the shell in the same terminal ────────────────────
//
// What a Claude tab shows once the agent is gone but the tab still claims
// `claude` (a hand-started agent's type outlives its process by about 30 minutes
// on the desktop). The phone's message plus Enter would be typed into the shell
// and RUN as a command.
//
// PROVENANCE. Mixed.
//   CAPTURED 2026-10-02 with `tmux capture-pane -p` (100 columns, HOME pointed
//   at an empty directory so the user's own prompt is not in it):
//     - zsh 5.9 (`zsh -f`): after `echo hi`, the prompt row is `66% ` (the host
//       name, then `%`), at column 0;
//     - bash 3.2.57 (`bash --norc --noprofile`): `bash-3.2$ ` at column 0.
//   MODELLED, not captured (no fish on this machine, no starship, no Claude run
//   for this fixture): fish's default `user@host ~> `, starship's `❯ ` (the
//   SAME glyph as Claude's input row, at column 0, with no rule under it), and
//   the resume hint Claude Code prints when it exits.
//   The box above the prompt is the 2.1.287 one (claude-composer-2.1.287.ts):
//   an agent that exits leaves its last frame in the scrollback, with the shell
//   prompt drawn under it. Orca drops blank rows.

import { EMPTY_COMPOSER } from './claude-composer-2.1.287'

export const SHELL_PROMPTS = {
  zsh: '66% ',
  bash: 'bash-3.2$ ',
  fish: 'alwinpaul@66 ~/proj> ',
  starship: '❯ ',
  /** What Claude prints on a clean exit, then the prompt. */
  resumeHint: 'Resume this session with:'
} as const

const RULE = '─'.repeat(190)

/** Claude's last frame (box and footer rows) with a shell prompt under it. */
export const claudeExitedToShell = (prompt: string): string[] => [...EMPTY_COMPOSER, prompt]

/** Claude's box with nothing drawn under its bottom rule but the shell prompt
 *  (the footer was cleared on exit). */
export const claudeBoxThenShell = (prompt: string): string[] => [
  '⏺ Done. The change is in.',
  RULE,
  '❯ ',
  RULE,
  prompt
]

/** A shell that never ran Claude, or whose screen was cleared: no box at all. */
export const plainShell = (prompt: string): string[] => ['hi', prompt]
