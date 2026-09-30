import { describe, expect, it } from 'vitest'
import { codexPermissionFromScreen } from './codex-terminal-permission'
import { isCodexIdle, isCodexWorking } from './codex-picker-screen'
import { hasCodexFooter, parseCodexHudObservation } from './mobile-terminal-hud-parse'

// Codex 0.158.0 painted these screens, captured by Orca's own runtime fixtures at v1.4.217
// (src/main/runtime/__fixtures__/codex-0-158-0-*.txt: raw PTY bytes, 120x40, launched as
// `codex --no-daemon -c check_for_update_on_startup=false --dangerously-bypass-approvals-and-sandbox`)
// and rendered here through tmux, which paints the cell-diff repaints the way a terminal does.
// What they pin: Orca 1.4.217 (#23475, #23765) changed how the HOST reads Codex readiness, because
// 0.158 dropped `model:` / `directory:` from the startup box. The phone never read those rows. It
// reads the composer placeholder, the input footer and the status row, and this file holds those to
// the 0.158.0 paint. Checked against captures only; a live Codex 0.158 tab has not been driven from
// the phone.

// After a turn: the header lost its model and directory rows, the composer is back, and the
// footer carries the thread title as a third field.
const IDLE_AFTER_TURN = [
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

// Mid-turn: `Working (0s • esc to interrupt)` sits above a composer that still shows its placeholder.
const WORKING = [
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

// Startup, before the composer exists: the header says `loading`, and the ASCII banner repaints.
const STARTING = [
  '',
  '  >_ OpenAI Codex (v0.158.0)',
  '     loading',
  '',
  '  Shall we see where this goes?',
  '',
  '',
  '                                                       ⣀⣤⣤⣤⣀⣀',
  '                                                    ⣠⣶⣿⣿⣿⣿⣿⣿⣿⣿⣦⣤⣤⣤⣤⣤⣤⡀',
  '                                                  ⢀⣾⣿⣿⠿⠋⠉⠉⢉⣭⣿⣿⣿⣿⣿⠿⣿⣿⣿⣿⣷⣄',
  '                                                 ⣀⣾⣿⣿⠃ ⣀⣴⣾⣿⣿⡿⠟⠋ ⣀⡀ ⠈⠙⢿⣿⣿⣧',
  '                                              ⣀⣶⣿⣿⣿⣿⡇ ⢸⣿⣿⡿⠛⠉⢀⣠⣴⣿⣿⣿⣷⣦⣀⠈⢻⣿⣿⡇'
]

// Codex 0.155.1, mid-turn, for contrast: the busy row is the SIXTH line from the bottom there, the very
// edge of the six-line tail the phone used to read.
const WORKING_0155 = [
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

// A command approval.
const APPROVAL = [
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

// The folder trust prompt a first launch in an unknown folder opens.
const TRUST_PROMPT = [
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

describe('Codex 0.158.0 screens', () => {
  it('reads the idle composer after a turn, without the model and directory rows', () => {
    expect(IDLE_AFTER_TURN.some((line) => /model:|directory:/.test(line))).toBe(false)
    expect(isCodexIdle(IDLE_AFTER_TURN)).toBe(true)
    expect(isCodexWorking(IDLE_AFTER_TURN)).toBe(false)
    expect(hasCodexFooter(IDLE_AFTER_TURN)).toBe(true)
    expect(parseCodexHudObservation(IDLE_AFTER_TURN)).toMatchObject({
      modelId: 'GPT-6-Sol',
      effort: 'medium'
    })
  })

  it('reads a running turn as working, not idle, though the placeholder is still drawn', () => {
    expect(WORKING.some((line) => line.includes('Ask Codex to do anything'))).toBe(true)
    expect(isCodexWorking(WORKING)).toBe(true)
    expect(isCodexIdle(WORKING)).toBe(false)
  })

  it('still reads Codex 0.155.1 mid-turn as working', () => {
    expect(isCodexWorking(WORKING_0155)).toBe(true)
    expect(isCodexIdle(WORKING_0155)).toBe(false)
  })

  it('does not take a transcript sentence that mentions the key for a running turn', () => {
    const prose = [...IDLE_AFTER_TURN]
    prose.splice(9, 0, '• Press esc to interrupt (or ctrl+c) to stop a running turn.')
    expect(isCodexWorking(prose)).toBe(false)
    expect(isCodexIdle(prose)).toBe(true)
  })

  it('does not read the startup screen as an idle prompt', () => {
    expect(STARTING.some((line) => line.trim() === 'loading')).toBe(true)
    expect(isCodexIdle(STARTING)).toBe(false)
    expect(isCodexWorking(STARTING)).toBe(false)
    expect(parseCodexHudObservation(STARTING)).toBeNull()
  })

  it('recognizes the command approval and its shortcuts', () => {
    expect(isCodexIdle(APPROVAL)).toBe(false)
    const permission = codexPermissionFromScreen(APPROVAL)
    expect(permission?.title).toBe('Run this command?')
    expect(permission?.options.map((option) => option.send)).toEqual(['y', 'p', '\x1b'])
  })

  it('offers no answer for the folder trust prompt, and never mistakes it for an idle prompt', () => {
    // The phone has no Codex trust card: the dialog shows in the terminal view. Refusing to guess is
    // the safe half; a card for it would need its own decision.
    expect(codexPermissionFromScreen(TRUST_PROMPT)).toBeNull()
    expect(isCodexIdle(TRUST_PROMPT)).toBe(false)
    expect(isCodexWorking(TRUST_PROMPT)).toBe(false)
  })

  // The next three are Orca's own screens from src/main/runtime/codex-quiet-ready-screen.test.ts
  // (v1.4.217), pasted verbatim.
  it('reads an idle composer under an answer that quotes the busy row as idle', () => {
    const quotedInAnswer = [
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
    expect(isCodexWorking(quotedInAnswer)).toBe(false)
    expect(isCodexIdle(quotedInAnswer)).toBe(true)
    // The same screen mid-turn: the row sits above the composer, with Codex's one Tip line allowed between.
    const composer = quotedInAnswer.indexOf('› Ask Codex to do anything')
    const busy = [
      ...quotedInAnswer.slice(0, composer),
      '• Working (3s • esc to interrupt)',
      '  └ Tip: start a fresh idea with /new',
      '',
      ...quotedInAnswer.slice(composer)
    ]
    expect(isCodexWorking(busy)).toBe(true)
    expect(isCodexIdle(busy)).toBe(false)
  })

  it("reads 0.158's turn timestamp above the composer as the end of a quoted status row", () => {
    // Live 0.158 screen after a worker answered with a status row verbatim (STA-8834).
    const afterQuotedRow = [
      '  === TASK ===',
      '  Reply with exactly this line and nothing else: • Working (0s • esc to interrupt) — then call worker_done.',
      '• • Working (0s • esc to interrupt)',
      '• Ran orca-dev orchestration send --from term_f496fcd2-a874-4fa6-a9bd-550a515ac928 --dispatch-capability dcap_PTgPpvf-B…',
      '  └ Sent msg_ff7be3f25d7e',
      '    + Show details',
      '• • Working (0s • esc to interrupt)',
      '  11:15 PM',
      '› Ask Codex to do anything',
      '  GPT-6-Sol medium · ~/orca-lanes/sta8834/live3/scratch · Report task outcome',
      '  ? for shortcuts'
    ]
    expect(isCodexWorking(afterQuotedRow)).toBe(false)
    expect(isCodexIdle(afterQuotedRow)).toBe(true)
  })

  it('still reads a remapped interrupt key as busy', () => {
    const remapped = [...WORKING]
    const at = remapped.findIndex((line) => line.includes('esc to interrupt'))
    remapped[at] = '• Working (0s • ctrl+c to interrupt)'
    expect(isCodexWorking(remapped)).toBe(true)
  })

  // Codex's bottom pane draws the status row, a blank line, the pending-input preview, then the
  // composer (codex-rs/tui/src/bottom_pane/mod.rs, pending_input_preview.rs; the preview's own
  // wording is the fork's codex-terminal-queued-messages fixtures). Typing `/model` and Enter into a
  // running turn is what a wrong "idle" costs.
  it('reads a running turn with queued follow-ups as working', () => {
    const queued = [
      '› List the files here and summarize in 2 bullets.',
      '',
      '• Working (12s • esc to interrupt)',
      '',
      '• Queued follow-up inputs',
      '  ↳ then run the tests',
      '    ⌥ + ↑ edit last queued message',
      '',
      '› Ask Codex to do anything',
      '',
      '  GPT-6-Sol medium · ~/orca-lanes/sta8834/corpus/scratch',
      '  ? for shortcuts'
    ]
    expect(isCodexWorking(queued)).toBe(true)
    expect(isCodexIdle(queued)).toBe(false)
    const steer = [
      '• Working (3s • esc to interrupt)',
      '',
      '• Messages to be submitted after next tool call (press esc',
      '  to interrupt and send immediately)',
      '  ↳ steer from phone',
      '',
      '• Messages to be submitted at end of turn',
      '  ↳ retry this',
      '',
      '› Ask Codex to do anything',
      '  ? for shortcuts'
    ]
    expect(isCodexWorking(steer)).toBe(true)
  })

  it('reads a running turn with an auto-review detail line under the status row as working', () => {
    const review = [
      '• Working (4s • esc to interrupt)',
      '  └ Auto-reviewing: git push origin main',
      '',
      '› Ask Codex to do anything',
      '',
      '  GPT-6-Sol medium · ~/repo',
      '  ? for shortcuts'
    ]
    expect(isCodexWorking(review)).toBe(true)
  })

  it('does not read a quoted status row as working when the composer is not on screen', () => {
    // A pager or a `cat`ed transcript: prose quoting the row, no composer row at all.
    expect(isCodexWorking(['  It reads like this:', '  • Working (0s • esc to interrupt)'])).toBe(
      false
    )
    expect(isCodexWorking(['$ cat notes.txt', '• Working (0s • esc to interrupt)', '$'])).toBe(
      false
    )
  })

  it('reads the row above the composer, and not one that a "> " line follows', () => {
    const quoted = [
      '› what does the row look like?',
      '',
      '• It looks like:',
      '> quoting a shell prompt',
      '• Working (0s • esc to interrupt)',
      '',
      '› Ask Codex to do anything',
      '  ? for shortcuts'
    ]
    // The row above the composer IS a busy row here: this screen is a real turn, not a quote.
    expect(isCodexWorking(quoted)).toBe(true)
    const quotedAbove = [
      '› what does the row look like?',
      '',
      '• Working (0s • esc to interrupt)',
      '> a shell prompt quoted after it',
      '',
      '› Ask Codex to do anything',
      '  ? for shortcuts'
    ]
    expect(isCodexWorking(quotedAbove)).toBe(false)
  })
})
