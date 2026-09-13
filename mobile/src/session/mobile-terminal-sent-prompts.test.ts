import { describe, expect, it } from 'vitest'
import { sentPromptsFromScreen } from './mobile-terminal-sent-prompts'

const NBSP = '\u00a0'

// Claude Code 2.1.270, captured with `tmux capture-pane -p` on 2026-09-13
// (100 columns). A slash command with its output, a prompt that wrapped twice,
// the tool fold under it, the reply, and the composer with the status area
// beneath it.
const SCREEN = [
  '❯ /effort high',
  '  ⎿  Set effort level to high (saved as your default for new sessions): Comprehensive implementation',
  '     with extensive testing and documentation',
  '',
  '❯ run echo one and then echo two, then reply with the single word done',
  '  second prompt that is long enough to wrap around the terminal width of one hundred columns for',
  '  sure yes',
  '',
  '  Ran 1 shell command',
  '',
  '⏺ done',
  '',
  '  session:ok',
  '',
  '✻ Baked for 7s · done 10:25 AM',
  '',
  '────────────────────────────────────────────────────────────────────────────────────────────────────',
  `❯${NBSP}`,
  '────────────────────────────────────────────────────────────────────────────────────────────────────',
  '  [Haiku 4.5 | Max 20x] ██░░░░ 26% (52k/200k) | probe | 1 CLAUDE.md | 4 rules | 3 MCPs | 12 hooks',
  '  Usage ░░░░░░ 6% (resets 3:10 PM) | Weekly ███░░░ 46% (resets Wed 7:00 PM)',
  '  ───────────────────────────────────────────────────────────────────────────────────────────────',
  '  ✓ Bash ×1',
  '  ⏸ manual mode on · ← for agents'
]

// The same build, mid-turn, as it stood on the phone on 2026-09-13: a prompt
// with an image and two rule files loaded by a hook, then the running tool.
function midTurn(seconds: number): string[] {
  return [
    '❯ When a model switch happens this too appears fix that',
    '  ⎿  [Image #89]',
    '  ⎿  Loaded ../../../.claude/rules/no-inline-imports.md',
    '  ⎿  Loaded ../../../.claude/rules/typescript-exhaustive-switch.md',
    '',
    '  Ran 6 shell commands',
    '',
    `⏺ Bash(Drive a live Claude Code 2.1.270 in tmux and capture its real scrollback rows · ${seconds}s`,
    '  ⎿  $ cd /private/tmp/claude-501/scratchpad && mkdir -p probe && cd probe && tmux kill-session',
    `     -t cuiprobe 2>/dev/null; tmux new-session -d -s cuiprobe (${seconds}s) (ctrl+b to run in`,
    '     background)',
    '',
    '✻ Cooking… (esc to interrupt)',
    '',
    '────────────────────────────────────────────────────────────────────────────────────────────────────',
    '❯',
    '────────────────────────────────────────────────────────────────────────────────────────────────────',
    '  [Fable 5.1 | Max 20x] ██░░░░ 26% (52k/200k) | Code UI | 1 CLAUDE.md | 4 rules | 3 MCPs'
  ]
}

describe('sentPromptsFromScreen', () => {
  it('reads a prompt the agent already took, rejoining the rows it wrapped', () => {
    expect(sentPromptsFromScreen(SCREEN)).toEqual([
      'run echo one and then echo two, then reply with the single word done second prompt that is long enough to wrap around the terminal width of one hundred columns for sure yes'
    ])
  })

  it('leaves the "Ran N shell commands" fold under the prompt out of it', () => {
    expect(sentPromptsFromScreen(SCREEN).join(' ')).not.toContain('Ran 1 shell command')
  })

  it('skips a slash command and the output painted under it', () => {
    const prompts = sentPromptsFromScreen(SCREEN).join(' ')
    expect(prompts).not.toContain('/effort')
    expect(prompts).not.toContain('Set effort level')
  })

  it('stops at the attachment and hook rows the agent paints under a prompt', () => {
    expect(sentPromptsFromScreen(midTurn(6))).toEqual([
      'When a model switch happens this too appears fix that'
    ])
  })

  it('reads the same text every poll while a tool timer ticks', () => {
    expect(sentPromptsFromScreen(midTurn(6))).toEqual(sentPromptsFromScreen(midTurn(13)))
  })

  it('never reads the composer, stripped bare or carrying a draft', () => {
    const typing = [...SCREEN]
    typing[17] = `❯${NBSP}a draft the user is still typing on the desktop`
    expect(sentPromptsFromScreen(typing).join(' ')).not.toContain('still typing')
    expect(sentPromptsFromScreen(midTurn(6)).join(' ')).not.toContain('Fable 5.1')
  })

  it('returns nothing for a screen with no prompt rows', () => {
    expect(sentPromptsFromScreen(['  Ran 3 shell commands', '', '✻ Cooking…', '❯'])).toEqual([])
  })
})
