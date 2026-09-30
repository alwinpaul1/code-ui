import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  parseCodexHudObservation,
  parseTerminalHudObservation,
  parseTerminalPermissionMode,
  readTerminalPermissionMode,
  type TerminalPermissionMode
} from './mobile-terminal-hud-parse'

// The permission mode was read from ANY row that contained "bypass
// permissions on" (or the other four phrases), from the bottom of the screen
// up. The footer won only when it was drawn lowest, so while a dialog or a
// repaint hid it, a line of conversation set the pill, and the mode stepper,
// which acts on the stated mode, took it as said (review, 2026-09-30). The
// mode is the footer's: its row, near the bottom, in the footer's shape.

/** Every row of a capture under fixtures/, or the rows after one of its
 *  `=== screen: … ===` markers. */
function readCapture(file: string, screen?: string): string[] {
  const rows = readFileSync(fileURLToPath(new URL(`./fixtures/${file}`, import.meta.url)), 'utf8').split('\n')
  if (screen === undefined) {
    return rows
  }
  const start = rows.indexOf(`=== screen: ${screen} ===`) + 1
  const end = rows.findIndex((row, index) => index >= start && row.startsWith('=== screen: '))
  return rows.slice(start, end === -1 ? undefined : end)
}

// The composer as Claude Code 2.1.281 paints it (sent-photos capture, tmux).
const RULE = '────────────────────────────────────────────────────────────────────────────────────────────────────'
const COMPOSER_2_1_281 = [RULE, '❯ ', RULE]
// Claude Code 2.1.277's status area above its footer, verbatim from the frame
// read on 2026-09-19 (`orca terminal read --screen`,
// mobile-terminal-queued-messages.test.ts).
const STATUS_2_1_277 = [
  '────────────────────────────────────────────────────────────────────────────────',
  '❯',
  '────────────────────────────────────────────────────────────────────────────────',
  '  [Opus 5 (1M context) xhigh | Max 20x] ██░░░░ 28% (275k/1.0M)',
  '  Usage ░░░░░░ 7% (resets 1:20 AM) | Weekly ██░░░░ 38% (resets Wed 7:00 PM)',
  '  ─────────────────────────────────────────────────────────────────────────',
  '  ✓ Bash ×19 | ✓ Skill ×1'
]
// A sentence of conversation naming a mode (the review's example). Claude
// paints its replies after "⏺", Codex after "•".
const TALK = 'I would not use bypass permissions on prod.'

describe("Claude Code's permission mode, from its footer only", () => {
  it('states no mode when the only mention is a line of conversation', () => {
    expect(readTerminalPermissionMode([TALK])).toBeNull()
    expect(readTerminalPermissionMode([`⏺ ${TALK}`])).toBeNull()
    expect(parseTerminalPermissionMode([TALK])).toBe('default')
  })

  it('states no mode while the footer is not painted yet, however near the bottom the conversation sits', () => {
    // A read taken mid-repaint: the reply and the composer are drawn, the
    // footer row under them is not.
    const screen = [`⏺ ${TALK}`, '', ...COMPOSER_2_1_281]
    expect(readTerminalPermissionMode(screen)).toBeNull()
    expect(parseTerminalHudObservation([`⏺ ${TALK}`, '', ...STATUS_2_1_277])).toMatchObject({
      modelId: 'opus',
      permissionMode: 'default',
      permissionModeSeen: null
    })
  })

  it("reads the footer's mode, not the conversation's, when that line sits right above a real footer", () => {
    // 2.1.270 (tmux, 2026-09-13; mobile-terminal-sent-prompts.test.ts).
    expect(readTerminalPermissionMode([TALK, '  ⏸ manual mode on · ← for agents'])).toBe('manual')
  })

  it.each<[string, string[], TerminalPermissionMode]>([
    [
      '2.1.281 idle, tmux (claude-screen-sent-photos-2.1.281.txt)',
      readCapture('claude-screen-sent-photos-2.1.281.txt'),
      'auto'
    ],
    [
      '2.1.282 after the answer, tmux (claude-screen-ask-single-select-2.1.282.txt)',
      readCapture('claude-screen-ask-single-select-2.1.282.txt', 'after 2'),
      'auto'
    ],
    [
      '2.1.281 with no "· ← for agents" item (claude-screen-ask-single-select-2.1.281.txt)',
      readCapture('claude-screen-ask-single-select-2.1.281.txt', 'after a second 1, eight seconds later'),
      'auto'
    ],
    [
      '2.1.278 at 46 columns, the hint cut short (claude-screen-peer-message-2.1.278.txt)',
      readCapture('claude-screen-peer-message-2.1.278.txt'),
      'bypassPermissions'
    ],
    [
      '2.1.277 with a shell running, orca terminal read (mobile-terminal-queued-messages.test.ts)',
      [...STATUS_2_1_277, '  ⏵⏵ auto mode on · 1 shell · ← for agents'],
      'auto'
    ],
    [
      'the 2026-09-14 screen drawn with ▶▶ (mobile-terminal-hud-parse.ts)',
      ['▶▶ auto mode on · 4 shells · ← for agents'],
      'auto'
    ],
    [
      '2.1.276 after a plan was approved, tmux (answered-prompt-terminal-notice.test.tsx)',
      [
        "⏺ User approved Claude's plan",
        '  ⎿  Plan saved to: ~/.claude/plans/write-a-one-sentence-plan-expressive-possum.md · /plan to edit',
        '  ⏸ manual mode on · ← for agents'
      ],
      'manual'
    ],
    [
      'a hand-started claude, terminal.read 2026-09-18 (use-mobile-native-chat-hud.test.ts)',
      [
        '[Opus 5 (1M context) xhigh | Max 20x] ██░░░░░░░░ 22% (217k/1.0M) | Code UI git:(main ↑15) | 2 CLAUDE.md | 4 rules | 3 MCPs',
        '',
        '❯ ',
        '  ⏵⏵ accept edits on (shift+tab to cycle)'
      ],
      'acceptEdits'
    ]
  ])('still reads the mode off the footer Claude Code %s painted', (_capture, screen, mode) => {
    expect(readTerminalPermissionMode(screen)).toBe(mode)
    expect(parseTerminalPermissionMode(screen)).toBe(mode)
  })

  it('reads the footer when blank rows sit under it', () => {
    // The 2.1.282 capture's question screen ends in 21 blank rows under what
    // is drawn; a footer can have the same under it.
    const blankTail = readCapture('claude-screen-ask-single-select-2.1.282.txt', 'ask').slice(-21)
    expect(blankTail.every((row) => row === '')).toBe(true)
    const screen = [...STATUS_2_1_277, '  ⏵⏵ auto mode on · 1 shell · ← for agents', ...blankTail]
    expect(readTerminalPermissionMode(screen)).toBe('auto')
  })

  it('states no mode while a question covers the footer', () => {
    expect(readTerminalPermissionMode(readCapture('claude-screen-ask-single-select-2.1.282.txt', 'ask'))).toBeNull()
  })

  // Plan mode's footer has never been captured. These rows are the shape every
  // captured mode row shares (2.1.270-2.1.282, in claude-terminal-mode-footer.ts)
  // with plan's phrase in it: inferred, not seen. Replace them with a real
  // capture when one is taken.
  it.each([
    ['with the whole hint', '  ⏸ plan mode on (shift+tab to cycle)'],
    ['with the hint cut short at a narrow width', '  ⏸ plan mode on (shift+tab to  ·'],
    ['with a "·" item after it', '  ⏸ plan mode on · ← for agents']
  ])('reads plan mode off a footer-shaped row %s', (_shape, footer) => {
    expect(readTerminalPermissionMode(['❯ ', footer])).toBe('plan')
    expect(readTerminalPermissionMode([...STATUS_2_1_277, footer])).toBe('plan')
    expect(parseTerminalPermissionMode(['❯ ', footer])).toBe('plan')
  })

  it('states no plan mode when a line of conversation in the bottom rows names it', () => {
    // The review's repro: every row is inside the bottom six, and the only
    // mention is a sentence, not a footer (2026-09-30).
    expect(
      readTerminalPermissionMode(['ok', 'plan mode on is set here', '╭──╮', '│ > │', '╰──╯'])
    ).toBeNull()
    // A reply right above the composer, with the footer not painted yet.
    const screen = ['⏺ Turned plan mode on for the next step.', '', ...COMPOSER_2_1_281]
    expect(screen.length).toBeLessThanOrEqual(6)
    expect(readTerminalPermissionMode(screen)).toBeNull()
    expect(parseTerminalPermissionMode(screen)).toBe('default')
    // Eight rows up, above the whole status area: conversation, not a footer.
    expect(
      readTerminalPermissionMode(['⏺ Turned plan mode on for the next step.', ...STATUS_2_1_277])
    ).toBeNull()
  })

  it("reads the plan footer, not the conversation's mode, when that line sits right above it", () => {
    expect(readTerminalPermissionMode([TALK, '  ⏸ plan mode on (shift+tab to cycle)'])).toBe('plan')
    expect(
      readTerminalPermissionMode([
        '⏺ Turned plan mode on for the next step.',
        '  ⏸ manual mode on · ← for agents'
      ])
    ).toBe('manual')
  })

  it('reads plan mode on a one-row screen only when that row is the footer', () => {
    expect(readTerminalPermissionMode(['plan mode on is set here'])).toBeNull()
    expect(readTerminalPermissionMode(['  ⏸ plan mode on (shift+tab to cycle)'])).toBe('plan')
  })

  it('states no mode for an empty screen or a single blank row', () => {
    expect(readTerminalPermissionMode([])).toBeNull()
    expect(readTerminalPermissionMode([''])).toBeNull()
    expect(parseTerminalPermissionMode([])).toBe('default')
  })
})

describe('Codex screens, which have no Claude mode footer', () => {
  // codex-cli 0.153.4, live capture on 2026-09-09 (mobile-terminal-hud-parse.test.ts).
  const CODEX_0_153_4 = [
    '› Reply with the single word ready.   tab to queue message',
    '                                                                        100% context left',
    '› Reply with the single word ready.',
    '  gpt-5.6-terra xhigh · ~/Desktop/Project/Code UI'
  ]
  // The Plan row mobile-terminal-hud-parse.test.ts reads (its build is not recorded).
  const CODEX_PLAN = [
    '› Ask Codex to do anything',
    '  gpt-5.6-sol medium · ~/Project                          Plan mode (shift+tab to cycle)'
  ]

  it('states no Claude permission mode on a Codex footer, in Default or in Plan', () => {
    expect(parseCodexHudObservation(CODEX_0_153_4)).toMatchObject({
      modelId: 'gpt-5.6-terra',
      permissionMode: 'default',
      permissionModeSeen: null,
      agentMode: 'default'
    })
    expect(parseCodexHudObservation(CODEX_PLAN)).toMatchObject({
      permissionMode: 'default',
      permissionModeSeen: null,
      agentMode: 'plan'
    })
  })

  it('states no Claude permission mode when a Codex reply names one', () => {
    expect(parseCodexHudObservation([`• ${TALK}`, ...CODEX_PLAN])).toMatchObject({
      permissionModeSeen: null,
      agentMode: 'plan'
    })
  })

  it('states no Claude plan mode when a Codex conversation row near the bottom says plan mode on', () => {
    // Codex paints a reply after "•" and its wrapped rows under two spaces.
    const reply = [
      '• I left plan mode on for the next step.',
      '  plan mode on is set here, as you asked.'
    ]
    const screen = [...reply, ...CODEX_0_153_4]
    expect(screen.length).toBeLessThanOrEqual(6)
    expect(readTerminalPermissionMode(screen)).toBeNull()
    expect(parseCodexHudObservation(screen)).toMatchObject({
      modelId: 'gpt-5.6-terra',
      permissionMode: 'default',
      permissionModeSeen: null,
      agentMode: 'default'
    })
    expect(parseCodexHudObservation([...reply, ...CODEX_PLAN])).toMatchObject({
      permissionMode: 'default',
      permissionModeSeen: null,
      agentMode: 'plan'
    })
  })
})
