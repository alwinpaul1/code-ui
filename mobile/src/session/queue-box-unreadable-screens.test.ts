import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { queueBoxReadFromScreen } from './mobile-terminal-queue-read'

// Screens on which the agent's queue box cannot be seen read as an EMPTY box,
// and the queue-box witness took that for the agent taking every message it
// had listed (review of the per-entry echo rewrite, 2026-09-30). A read says
// whether it saw the box; one that did not is unknown, not empty. Real screens
// only: tmux captures, and the Codex 0.158.0 screens Orca's runtime fixtures
// painted.

function captured(file: string): string[] {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${file}`, import.meta.url)), 'utf8')
    .split('\n')
    .filter((row) => !row.startsWith('# '))
}

// Claude Code 2.1.263, `tmux capture-pane -p` at 80 columns, three queued
// messages (mobile-terminal-queued-messages.test.ts QUEUE_ROWS). The composer
// is the bare `❯`: Orca takes the hint out of it and publishes it as the draft.
const QUEUE_ROWS_2_1_263 = [
  '  ❯ alpha this is a deliberately long first queued message that must wrap',
  '    across at least two rendered terminal lines to reveal the continuation',
  '    indent',
  '  ❯ bravo short second',
  '  ❯ charlie another very long third queued message written so that it also',
  '    wraps onto a second line inside the queue block for comparison purposes',
  '',
  '────────────────────────────────────────',
  '❯',
  '────────────────────────────────────────',
  '  [Haiku 4.5 | Team] ░░░░░░ 0% (0/200k) | qtest'
]
/** The same capture with `bravo` selected: Claude drops the other markers. */
const SELECTED_2_1_263 = QUEUE_ROWS_2_1_263.map((line, index) =>
  [0, 4].includes(index) ? line.replace('  ❯ ', '    ') : line
)
const SELECT_HINT = 'Press up to select a queued message, then Enter to edit it'
const SELECTED_HINT = 'Press Enter to edit the selected message, or up again for an older one'

// Claude Code 2.1.277, captured live with `orca terminal read --screen`.
const QUEUE_2_1_277 = [
  '⏺ Running 5 shell commands…',
  '  ⎿  $ cd "/Users/alwinpaul/Desktop/Project/Code UI/mobile" && grep -n',
  '     "clipboardImage" src/session/MobileNativeChatOverlay.tsx | head; echo "==',
  '     "MobileNativeCha…',
  '✻ Frolicking… (15m 36s · ↓ 56.6k tokens)',
  "❯ [Image #4] [Image #5] Also see a message i send from claude mobile app isn't",
  '  still here on our codeui app',
  '  ctrl+x ctrl+s to send now',
  '                                                  Ctrl+Y to paste deleted text',
  '────────────────────────────────────────────────────────────────────────────────',
  '❯',
  '────────────────────────────────────────────────────────────────────────────────',
  '  [Opus 5 (1M context) xhigh | Max 20x] ██░░░░ 28% (275k/1.0M)',
  '  Usage ░░░░░░ 7% (resets 1:20 AM) | Weekly ██░░░░ 38% (resets Wed 7:00 PM)',
  '  ─────────────────────────────────────────────────────────────────────────',
  '  ✓ Bash ×19 | ✓ Skill ×1',
  '  ⏵⏵ auto mode on · 1 shell · ← for agents'
]
const QUEUE_HINT = 'Press up to edit queued messages'

// Claude Code 2.1.278 idle, tmux: its composer is up and nothing is queued.
const IDLE_2_1_278 = captured('claude-screen-task-completions-2.1.278.txt')
// Claude Code 2.1.283's Bash permission prompt, which replaces the composer
// (transcribed from a screenshot; see the fixture's header).
const PERMISSION_2_1_283 = captured('claude-screen-subagent-bash-permission-2.1.283.txt')

// Codex 0.158.0 (codex-0158-screens.test.ts): mid-turn with the composer up,
// and a command approval over it. The approval's selected option is drawn
// with the composer's own `› `.
const CODEX_WORKING_0158 = [
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
const CODEX_APPROVAL_0158 = [
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
const CODEX_TRUST_PROMPT_0158 = [
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
/** The 0.158 preview over the WORKING screen's composer, as the popup tests
 *  build it from the snapshots (codex-queue-under-an-open-popup.test.ts). */
const CODEX_QUEUED_0158 = [
  ...CODEX_WORKING_0158.slice(0, 13),
  '• Queued follow-up inputs',
  '  ↳ run the tests again',
  '    shift+← edit last queued message',
  ...CODEX_WORKING_0158.slice(13)
]

describe('a Claude Code queue box read that cannot see the box', () => {
  it('is not an emptied box while an entry is selected at the desk', () => {
    expect(queueBoxReadFromScreen(SELECTED_2_1_263, 'claude', SELECTED_HINT)).toEqual({ entries: [], readable: false, editable: false })
  })

  it('is not an emptied box while a permission prompt covers the composer', () => {
    expect(queueBoxReadFromScreen(PERMISSION_2_1_283, 'claude')).toEqual({ entries: [], readable: false, editable: false })
  })

  it('is not an emptied box when the reader refuses a block Claude says holds messages', () => {
    // The 2.1.277 capture read from its queued row down, as a short terminal
    // shows it: nothing bounds the block above, so the reader refuses rather
    // than take what may be the transcript for the queue.
    const unbounded = QUEUE_2_1_277.slice(5)
    expect(queueBoxReadFromScreen(unbounded, 'claude', QUEUE_HINT)).toEqual({ entries: [], readable: false, editable: false })
  })

  it('reads the box it can see: listed messages, and an empty box under an idle composer', () => {
    expect(queueBoxReadFromScreen(QUEUE_ROWS_2_1_263, 'claude', SELECT_HINT).readable).toBe(true)
    expect(queueBoxReadFromScreen(QUEUE_ROWS_2_1_263, 'claude', SELECT_HINT).entries).toHaveLength(3)
    expect(queueBoxReadFromScreen(QUEUE_2_1_277, 'claude', QUEUE_HINT)).toEqual({
      entries: ["[Image #4] [Image #5] Also see a message i send from claude mobile app isn't\nstill here on our codeui app"],
      readable: true,
      editable: true
    })
    expect(queueBoxReadFromScreen(IDLE_2_1_278, 'claude')).toEqual({ entries: [], readable: true, editable: false })
  })

  // Degenerate: nothing on screen at all, and a one-entry box.
  it('cannot see a box on an empty screen, and reads a box of one', () => {
    expect(queueBoxReadFromScreen([], 'claude')).toEqual({ entries: [], readable: false, editable: false })
    expect(queueBoxReadFromScreen(QUEUE_ROWS_2_1_263.slice(3), 'claude', QUEUE_HINT)).toEqual({
      entries: ['bravo short second', 'charlie another very long third queued message written so that it also\nwraps onto a second line inside the queue block for comparison purposes'],
      readable: true,
      editable: true
    })
  })
})

describe('a Codex queue box read that cannot see the box', () => {
  it('is not an emptied box while a command approval covers the composer', () => {
    expect(queueBoxReadFromScreen(CODEX_APPROVAL_0158, 'codex')).toEqual({ entries: [], readable: false, editable: false })
  })

  it('is not an emptied box while the folder trust prompt is up', () => {
    expect(queueBoxReadFromScreen(CODEX_TRUST_PROMPT_0158, 'codex')).toEqual({ entries: [], readable: false, editable: false })
  })

  it('reads the box it can see: a listed message, and an empty box under the composer', () => {
    expect(queueBoxReadFromScreen(CODEX_QUEUED_0158, 'codex')).toEqual({ entries: ['run the tests again'], readable: true, editable: true })
    expect(queueBoxReadFromScreen(CODEX_WORKING_0158, 'codex')).toEqual({ entries: [], readable: true, editable: false })
  })

  it('reads a listed message under an open slash popup', () => {
    const popup = [
      ...CODEX_QUEUED_0158.slice(0, 16),
      '› /resume  resume a saved chat',
      '',
      '› /res',
      ...CODEX_WORKING_0158.slice(15)
    ]
    expect(queueBoxReadFromScreen(popup, 'codex')).toEqual({ entries: ['run the tests again'], readable: true, editable: true })
  })

  // Degenerate: nothing on screen.
  it('cannot see a box on an empty screen', () => {
    expect(queueBoxReadFromScreen([], 'codex')).toEqual({ entries: [], readable: false, editable: false })
  })
})

describe('an agent whose queue box the phone does not read', () => {
  it('never reads it as an emptied box', () => {
    expect(queueBoxReadFromScreen(CODEX_WORKING_0158, 'omp')).toEqual({ entries: [], readable: false, editable: false })
    expect(queueBoxReadFromScreen(IDLE_2_1_278, null)).toEqual({ entries: [], readable: false, editable: false })
  })
})
