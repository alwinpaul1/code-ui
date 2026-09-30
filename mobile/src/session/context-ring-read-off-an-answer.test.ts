import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseCodexHudObservation, parseTerminalHudObservation } from './mobile-terminal-hud-parse'

// On a tab with no status line and no beacon (a hand-started session, where the screen is the only
// source), the context ring was read off the agent's own answer: Claude's "You are at about 45%
// context right now" set a 45% ring, and Codex's "It says 62% context left" a 38% one (review,
// 2026-09-30). Only the agent's own paintings may state the figure: rows under Claude's input box and
// its own low-context warning, and Codex's footer and its /status box.

function readCapture(file: string): string[] {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${file}`, import.meta.url)), 'utf8').split('\n')
}

// Claude Code 2.1.281 idle, tmux (claude-screen-sent-photos-2.1.281.txt), as a host with no status
// line paints it: claude-hud's badge row taken out, so the input box and the mode footer are left.
const CAPTURE_2_1_281 = readCapture('claude-screen-sent-photos-2.1.281.txt').filter(
  (row) => !/^\s*\[Opus/.test(row)
)
// The rule over the input row.
const BOX_TOP = CAPTURE_2_1_281.findLastIndex((row) => row.startsWith('❯')) - 1
/** The bare 2.1.281 screen with `rows` put in just above its input box. */
const claudeScreen = (rows: string[]) => [...CAPTURE_2_1_281.slice(0, BOX_TOP), ...rows, ...CAPTURE_2_1_281.slice(BOX_TOP)]

// Codex 0.158.0 and 0.155.1 composers and footers, the captures in codex-0158-screens.test.ts.
const CODEX_0158 = ['› Ask Codex to do anything', '', '  GPT-6-Sol medium · ~/orca-lanes/sta8834/corpus/scratch', '  ? for shortcuts']
const CODEX_0155 = ['› Ask Codex to do anything', '', '  gpt-6-sol medium · ~/orca-lanes/sta8834/corpus/scratch · renaming... ⠙']

describe("Claude's context ring is not read off its own answer", () => {
  it('has a bare 2.1.281 footer with the whole hint and no badge to work on', () => {
    expect(CAPTURE_2_1_281.some((row) => row.includes('(shift+tab to cycle)'))).toBe(true)
    expect(CAPTURE_2_1_281.some((row) => row.includes('[Opus'))).toBe(false)
    expect(parseTerminalHudObservation(claudeScreen([]))).toMatchObject({ context: null, permissionModeSeen: 'auto' })
  })

  it('shows no ring for an answer that names a context figure (the reported screen)', () => {
    const reported = [
      '❯ how full is your context?',
      '',
      '⏺ You are at about 45% context right now, so there is plenty of room.',
      '',
      '────',
      '❯ ',
      '────',
      '  ⏵⏵ auto mode on (shift+tab to cycle)'
    ]
    expect(parseTerminalHudObservation(reported)).toMatchObject({ context: null, permissionModeSeen: 'auto' })
  })

  it('shows none for a figure in an answer continuation row, or in a status-line shape the answer quotes', () => {
    expect(
      parseTerminalHudObservation(
        claudeScreen(['⏺ Here is where we are:', '  You are at about 45% context right now.', ''])
      )?.context
    ).toBeNull()
    expect(
      parseTerminalHudObservation(claudeScreen(['⏺ claude-hud draws it as', '  78% (776k/1.0M)', '']))?.context
    ).toBeNull()
  })

  it("shows none for Claude Code's own warning quoted in an answer", () => {
    expect(
      parseTerminalHudObservation(claudeScreen(['⏺ The footer said 12% until auto-compact an hour ago.', '']))?.context
    ).toBeNull()
  })

  it('still reads a status line under the input box that states the figure without a badge', () => {
    // CONTEXT_PATTERNS' own "ctx N% a/b" shape, where a status line is painted: under the box.
    const at = CAPTURE_2_1_281.findLastIndex((row) => row.includes('(shift+tab to cycle)'))
    const screen = [...CAPTURE_2_1_281.slice(0, at), '  ctx 54% 537.2k/1M', ...CAPTURE_2_1_281.slice(at)]
    expect(parseTerminalHudObservation(screen)?.context).toEqual({
      usedPercent: 54,
      usedLabel: '537.2k',
      windowLabel: '1M'
    })
  })

  it("still reads Claude Code's own low-context warning above the box and on the footer row", () => {
    // Worded from the 2.1.266 binary (mobile-terminal-hud-parse.test.ts); no near-full session captured.
    const low = 'Context low (8% remaining) · Run /compact to compact & continue'
    expect(parseTerminalHudObservation(claudeScreen([low]))?.context?.usedPercent).toBe(92)
    const onFooter = CAPTURE_2_1_281.map((row) =>
      row.includes('(shift+tab to cycle)') ? `${row} · 12% until auto-compact` : row
    )
    expect(parseTerminalHudObservation(onFooter)?.context?.usedPercent).toBe(88)
  })
})

describe("Codex's context ring is not read off its own answer", () => {
  it('shows no ring for an answer that quotes the footer figure (the reported screen)', () => {
    const reported = [
      '› what does the footer say?',
      '• It says 62% context left in this build, which is fine.',
      '› Ask Codex to do anything',
      '  gpt-6-sol medium · ~/repo'
    ]
    expect(parseCodexHudObservation(reported)?.context).toBeNull()
    expect(parseTerminalHudObservation(reported)?.context).toBeNull()
  })

  it('shows none for an answer figure over the 0.158 and 0.155 footers, higher up or right above the composer', () => {
    for (const footer of [CODEX_0158, CODEX_0155]) {
      const answer = ['› how full is it?', '• About 62% context left.', '', '  The footer shows it after /status.', '']
      expect(parseCodexHudObservation([...answer, ...footer])?.context).toBeNull()
      expect(parseCodexHudObservation(['• Right now:', '  62% context left', ...footer])?.context).toBeNull()
    }
  })

  it('shows none for a /status box quoted in an answer, its frame indented', () => {
    const quoted = [
      '• The box reads:',
      '  │  Context window:              97% left (19.5K used / 258K)                              │',
      '',
      ...CODEX_0158
    ]
    expect(parseCodexHudObservation(quoted)?.context).toBeNull()
  })

  it('reads nothing off an empty screen, and the figure off a footer row that is the whole screen', () => {
    expect(parseCodexHudObservation([])).toBeNull()
    expect(parseCodexHudObservation(['• 62% context left'])).toBeNull()
    expect(parseCodexHudObservation(['  gpt-6-sol medium · ~/repo · 62% context left'])?.context?.usedPercent).toBe(38)
  })

  it('still reads the /status box whose frame is intact, and the 0.153.4 figure above the composer', () => {
    // codex-cli 0.15x /status and 0.153.4's transient footer figure (mobile-terminal-hud-parse.test.ts).
    expect(
      parseCodexHudObservation([
        '│  Context window:              97% left (19.5K used / 258K)                              │',
        '╰───────────────────────────────────────────────────────────────────────────────────────╯',
        ...CODEX_0158
      ])?.context
    ).toEqual({ usedPercent: 3, usedLabel: '19.5K', windowLabel: '258K' })
    expect(
      parseCodexHudObservation([
        '                                            62% context left',
        '› Ask Codex to do anything',
        '  gpt-5.6-terra xhigh · ~/p'
      ])?.context?.usedPercent
    ).toBe(38)
  })
})
