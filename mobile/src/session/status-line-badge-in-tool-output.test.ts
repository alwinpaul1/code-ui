import { describe, expect, it } from 'vitest'
import { parseTerminalHudObservation } from './mobile-terminal-hud-parse'

// A status-line-shaped row in a tool's output set the model pill to Sonnet and the context ring to
// 54% on a Claude tab with no status line of its own (review, 2026-09-30). The badge reader took
// `^\s*\[…\]` from any row, and a five-space tool-output indent passes `\s*`. Anchoring at column 0
// would not help: Claude Code's own status line is indented two spaces under its input box. A badge
// row now counts only under the agent's own input row.
//
// The box, the status line under it and the footer are the Claude Code 2.1.281 capture
// (fixtures/claude-screen-sent-photos-2.1.281.txt, tmux). The conversation rows above follow Claude
// Code's tool layout, '⏺ Bash(…)', '  ⎿  ' and a five-space continuation, as painted in the
// agent-message overlay probe (mobile-native-chat-agent-message-overlay.test.ts). The Codex rows are
// the 0.158.0 captures in codex-0158-screens.test.ts ('• Explored', '  └ …', '    …' under it).

const RULE = '─'.repeat(100)
const NBSP = ' '
const BOX = [RULE, `❯${NBSP}`, RULE]
const FOOTER_2_1_281 = '  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents'
const OWN_STATUS_LINE_2_1_281 =
  '  [Opus 5.5 xhigh | Bedrock] ░░░░░░░░░░ 0% (1/200k) | img-repro | 1 CLAUDE.md | 4 rules | 6 MCPs'
const PRINTED = '     [Sonnet 4.6 high | Max 20x] ctx 54% 537.2k/1M'
const TOOL_OUTPUT = [
  '⏺ Bash(./statusline.sh < sample.json)',
  '  ⎿  first line',
  PRINTED,
  '⏺ That prints the badge you asked about.'
]

describe('a status-line-shaped row in Claude’s tool output', () => {
  it('sets no model pill and no context ring on a tab with no status line', () => {
    const screen = [...TOOL_OUTPUT, RULE, '❯ ', RULE, '  ⏵⏵ auto mode on (shift+tab to cycle)']
    expect(parseTerminalHudObservation(screen)).toMatchObject({
      modelId: null,
      context: null,
      permissionModeSeen: 'auto'
    })
  })

  it('sets none when the box has nothing under it on screen, or its closing rule is cut off', () => {
    expect(parseTerminalHudObservation([...TOOL_OUTPUT, ...BOX])?.modelId ?? null).toBeNull()
    expect(
      parseTerminalHudObservation([...TOOL_OUTPUT, RULE, `❯${NBSP}`])?.modelId ?? null
    ).toBeNull()
  })

  it('reads the user’s own status line under the box, not the one printed above it', () => {
    const screen = [...TOOL_OUTPUT, '', ...BOX, OWN_STATUS_LINE_2_1_281, FOOTER_2_1_281]
    expect(parseTerminalHudObservation(screen)).toMatchObject({
      modelId: 'opus',
      effort: 'xhigh',
      context: { usedPercent: 0, usedLabel: '1', windowLabel: '200k' },
      permissionModeSeen: 'auto'
    })
  })

  it('reads a context figure the status line wrapped onto the next row under the box', () => {
    // The 2.1.281 status line cut after its badge, as a narrow pane wraps it.
    const screen = [
      ...BOX,
      '  [Opus 5.5 xhigh | Bedrock]',
      '  ░░░░░░░░░░ 12% (24k/200k) | img-repro',
      FOOTER_2_1_281
    ]
    expect(parseTerminalHudObservation(screen)).toMatchObject({
      modelId: 'opus',
      context: { usedPercent: 12, usedLabel: '24k', windowLabel: '200k' }
    })
  })
})

describe('a bracketed model row in Codex’s tool output', () => {
  const CODEX_OUTPUT = [
    '• Ran ./statusline.sh < sample.json',
    '  └ first line',
    '    [Sonnet 4.6 high | Max 20x] ctx 54% 537.2k/1M',
    '',
    '• That prints the badge you asked about.',
    '',
    '  9:46 PM',
    '',
    ''
  ]

  it('leaves the pill to the Codex footer and sets no ring', () => {
    const screen = [
      ...CODEX_OUTPUT,
      '› Ask Codex to do anything',
      '',
      '  GPT-6-Sol medium · ~/orca-lanes/sta8834/corpus/scratch · List and summarize files',
      '  ? for shortcuts'
    ]
    expect(parseTerminalHudObservation(screen)).toMatchObject({
      modelId: 'GPT-6-Sol',
      context: null
    })
  })

  it('sets nothing when the composer has no footer under it', () => {
    expect(
      parseTerminalHudObservation([...CODEX_OUTPUT, '› Ask Codex to do anything'])?.modelId ?? null
    ).toBeNull()
  })
})

describe('a badge with no input row of either agent on screen', () => {
  // Kept as it read: no capture shows a live status line without the box above it, and the
  // fixtures that pin a badge beside a bare `❯` (mobile-terminal-hud-badge-strictness.test.ts) or
  // on a screen of its own (mobile-terminal-hud-parse.test.ts) stand for a screen cut short.
  it('still reads the badge, indented or not', () => {
    expect(parseTerminalHudObservation([PRINTED])).toMatchObject({
      modelId: 'sonnet',
      context: { usedPercent: 54 }
    })
    expect(
      parseTerminalHudObservation(['[Opus 4.8 xhigh | Max 20x]  main  ~/code', '❯ '])?.modelId
    ).toBe('opus')
  })

  it('reads nothing from an empty screen', () => {
    expect(parseTerminalHudObservation([])).toBeNull()
  })
})
