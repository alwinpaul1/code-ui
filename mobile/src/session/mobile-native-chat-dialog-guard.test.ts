import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { terminalDialogOnScreen } from './mobile-native-chat-dialog-guard'

type Screen = { name: string; lines: string[] }

/** Every screen of a capture file, each after its `=== screen: … ===` line;
 *  a file with no marker is one screen after its header. */
function readScreens(file: string): Screen[] {
  const text = readFileSync(fileURLToPath(new URL(`./fixtures/${file}`, import.meta.url)), 'utf8')
  const rows = text.split('\n')
  const screens: Screen[] = []
  for (const row of rows) {
    const marker = /^=== screen: (.*) ===$/.exec(row)
    if (marker) {
      screens.push({ name: `${file}: ${marker[1]}`, lines: [] })
    } else {
      screens.at(-1)?.lines.push(row)
    }
  }
  return screens.length > 0 ? screens : [{ name: file, lines: rows.filter((row) => !row.startsWith('# ')) }]
}

// (A transcription of the user's screenshot, not a tmux capture; see the
// fixture's header for the bytes it cannot vouch for.)
const [SUBAGENT_PROMPT] = readScreens('claude-screen-subagent-bash-permission-2.1.283.txt')
const MULTI = readScreens('claude-screen-ask-multi-select-2.1.282.txt')
const TWO = readScreens('claude-screen-ask-two-questions-2.1.282.txt')
const SINGLE_281 = readScreens('claude-screen-ask-single-select-2.1.281.txt')
const SINGLE_282 = readScreens('claude-screen-ask-single-select-2.1.282.txt')
const IDLE = [
  ...readScreens('claude-screen-cross-session-message-2.1.278.txt'),
  ...readScreens('claude-screen-peer-message-2.1.278.txt'),
  ...readScreens('claude-screen-sent-photos-2.1.281.txt'),
  ...readScreens('claude-screen-task-completions-2.1.278.txt')
]
const byName = (screens: Screen[], name: string, nth = 0) =>
  screens.filter((screen) => screen.name.endsWith(`: ${name}`))[nth]!.lines

// Claude Code 2.1.276, one tmux session (mobile-native-chat-permission-send.test.ts).
const BASH_DIALOG_276 = [
  '────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────',
  ' Bash command',
  ' Tip: auto mode handles these prompts for you — choose "switch to auto mode" below',
  '',
  '   echo world >> note.txt && cat note.txt',
  '   Append "world" to note.txt and show the result',
  '',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  '   2. Yes, and always allow access to /private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Code-UI/5d877e39-1867-424',
  '      f-86b5-c080713c1563/scratchpad/plan-accept-repro from this project',
  '   3. Yes, and switch to auto mode · auto mode handles these prompts for you',
  '   4. No',
  '',
  ' Esc to cancel · Tab to amend'
]
const PLAN_REVIEW_276 = [
  '  ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────',
  '   Claude has written up a plan and is ready to execute. Would you like to proceed?',
  '',
  '   ❯ 1. Yes, and use auto mode',
  '     2. Yes, manually approve edits',
  '     3. Tell Claude what to change',
  '        shift+tab to approve with this feedback',
  '',
  '   ctrl+g to edit in VS Code · ~/.claude/plans/write-a-one-sentence-plan-expressive-possum.md'
]
// `orca terminal read --screen`, 2026-09-05 (mobile-terminal-permission-options.test.ts).
const ACCEPT_EDITS_BASH = [
  ' Bash command',
  ' Tip: auto mode handles these prompts for you — choose "switch to auto mode" below',
  '   touch /tmp/codeui-perm-test',
  '   Create empty test file',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  '   2. Yes, and always allow access to /private/tmp from this project',
  '   3. Yes, and switch to auto mode · auto mode handles these prompts for you',
  '   4. No',
  ' Esc to cancel · Tab to amend'
]
// Codex, from a screenshot (codex-terminal-permission.test.ts).
const CODEX_APPROVAL = [
  'Would you like to run the following command?',
  '',
  'Environment: local',
  'Reason: May I run the full test suite, including the local WebSocket integration tests?',
  '',
  '  $ pnpm exec vitest run > /tmp/codeui-026-tests.log 2>&1',
  '',
  '› 1. Yes, proceed (y)',
  "  2. Yes, and don't ask again for commands that start with `pnpm exec vitest` (p)",
  '  3. No, and tell Codex what to do differently (esc)',
  '',
  'Press enter to confirm or esc to cancel'
]
// Codex 0.153.4's model picker, `orca terminal read --screen` (codex-picker-screen.test.ts).
const CODEX_MODEL_PICKER = [
  '  Select Model and Effort',
  '  Access legacy models by running codex -m <model_name> or in your config.toml',
  '  1. gpt-6-astra (default)  Our most capable model for complex, demanding work.',
  '› 2. gpt-5.6-sol (current)  Reliable agentic workhorse for everyday tasks.',
  '  3. gpt-5.6-terra          Balanced agentic coding model for everyday work.',
  '  Press enter to confirm or esc to go back'
]
const CODEX_IDLE = ['• ok', '› Ask Codex to do anything', '  gpt-5.6-sol xhigh · ~/Project']

/** The 2.1.278 idle capture with `rows` put in just above its composer box. */
const TASKS = IDLE.find((screen) => screen.name.includes('task-completions'))!.lines
const COMPOSER_TOP = TASKS.findIndex((row) => row.startsWith('❯ ')) - 1
const withAboveComposer = (rows: string[]) => [
  ...TASKS.slice(0, COMPOSER_TOP),
  ...rows,
  ...TASKS.slice(COMPOSER_TOP)
]

describe('a dialog that takes keys as answers is up', () => {
  it.each([
    ['the 2.1.283 subagent Bash prompt (transcribed)', SUBAGENT_PROMPT!.lines],
    ['a 2.1.276 Bash prompt', BASH_DIALOG_276],
    ['a Bash prompt read with no blank rows (2026-09-05)', ACCEPT_EDITS_BASH],
    ['a 2.1.276 plan review', PLAN_REVIEW_276],
    ['a Codex command approval', CODEX_APPROVAL],
    ["Codex's open model picker, whose Enter picks a model", CODEX_MODEL_PICKER],
    ['a 2.1.282 single-select ask', byName(SINGLE_282, 'ask')],
    ['a 2.1.281 single-select ask', byName(SINGLE_281, 'ask')],
    ['a 2.1.282 multi-select ask', byName(MULTI, 'ask')],
    ['the multi-select ask after 1', byName(MULTI, 'after 1')],
    ['the multi-select ask after 3', byName(MULTI, 'after 3')],
    ['the multi-select ask on its Submit tab', byName(MULTI, 'after Right')],
    ['the two-question ask on "Tab in Fleet"', byName(TWO, 'ask')],
    ['the two-question ask on its second question', byName(TWO, 'after 1', 0)],
    ['the two-question ask on its review step', byName(TWO, 'after 1', 1)]
  ])('sees %s', (_name, lines) => {
    expect(terminalDialogOnScreen(lines)).toBe(true)
  })

  it('also takes the ">" marker the screen readers accept', () => {
    expect(terminalDialogOnScreen(ACCEPT_EDITS_BASH.map((row) => row.replace(' ❯ 1.', ' > 1.')))).toBe(true)
  })
})

describe('nothing in the conversation reads as a dialog', () => {
  // The four shapes an independent review found refused every chat write.
  it("lets a send go past the user's own prompt that answered by number", () => {
    expect(
      terminalDialogOnScreen(withAboveComposer(['❯ 1. yes, delete the old screenshots', "  2. no, don't push yet", '']))
    ).toBe(false)
  })

  it('lets a send go past a dialog Claude quoted in its reply', () => {
    expect(
      terminalDialogOnScreen(
        withAboveComposer([
          '⏺ The prompt read:',
          '',
          '   ❯ 1. Yes',
          "     2. Yes, and don't ask again for: git *",
          '     3. No',
          ''
        ])
      )
    ).toBe(false)
  })

  it('lets a send go past a queued message that answers by number', () => {
    expect(terminalDialogOnScreen(withAboveComposer(['  ❯ 1. yes', '    2. no']))).toBe(false)
  })

  it('lets a send go past a Codex answer by number in its history', () => {
    expect(
      terminalDialogOnScreen(['› 1. Yes, use postgres', '  2. No caching for now', '', '• ok', ...CODEX_IDLE.slice(1)])
    ).toBe(false)
  })

  it('lets a send go past its own draft the mirror typed into the Codex composer', () => {
    expect(terminalDialogOnScreen(['• ok', '› 1. Yes, use postgres', '  2. No caching for now', CODEX_IDLE[2]!])).toBe(
      false
    )
  })

  it.each([
    ...IDLE.map((screen) => [screen.name, screen.lines] as const),
    // Each ask capture once it was answered: the composer is back.
    ['the answered multi-select ask', byName(MULTI, 'after Enter')] as const,
    ['the answered two-question ask', byName(TWO, 'after Enter')] as const,
    ['the answered 2.1.281 ask', byName(SINGLE_281, 'after 1')] as const,
    ['the 2.1.281 ask answered twice', byName(SINGLE_281, 'after a second 1, eight seconds later')] as const,
    ['the answered 2.1.282 ask', byName(SINGLE_282, 'after 2')] as const,
    ['an idle Codex screen', CODEX_IDLE] as const,
    ['an empty screen', []] as const,
    ['a blank screen', ['', '', '']] as const
  ])('sees none on %s', (_name, lines) => {
    expect(terminalDialogOnScreen([...lines])).toBe(false)
  })
})
