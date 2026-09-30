import { describe, expect, it } from 'vitest'
import {
  parseClaudeRunningShellCount,
  parseTerminalHudObservation
} from './mobile-terminal-hud-parse'

// Swept with the status-line badge read off a tool's output (status-line-badge-in-tool-output.test.ts):
// the footer's shell count was read from any of the last eight rows, and on a host with no status
// line four of those are conversation above the input box. An answer quoting the footer ("auto mode
// on · 4 shells") set a shell count the footer did not state, and that count caps the lead's named
// shells (mobile-background-task-footer.ts).
//
// The box and the footers are Claude Code captures already in the suite: 2.1.281
// (fixtures/claude-screen-sent-photos-2.1.281.txt, tmux) with its status line taken out, and 2.1.277
// with a shell running (`orca terminal read --screen`, 2026-09-19; claude-footer-without-status-line.test.ts).

const RULE = '─'.repeat(80)
const BOX = [RULE, '❯', RULE]
const ANSWER =
  '⏺ The footer said "auto mode on · 4 shells · ← for agents", so four were running then.'

describe('the running shell count on a Claude screen with its input box', () => {
  it('reads no count from an answer quoting the footer above the box', () => {
    const screen = [ANSWER, '', ...BOX, '  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents']
    expect(parseClaudeRunningShellCount(screen)).toBeNull()
    expect(parseTerminalHudObservation(screen)?.runningShellCount).toBeUndefined()
  })

  it('reads none from an answer when the box has nothing under it on screen', () => {
    expect(parseClaudeRunningShellCount([ANSWER, '', ...BOX])).toBeNull()
  })

  it('still reads the count the footer under the box states', () => {
    const screen = [ANSWER, ...BOX, '  ⏵⏵ auto mode on · 1 shell · ← for agents']
    expect(parseClaudeRunningShellCount(screen)).toBe(1)
    expect(parseTerminalHudObservation(screen)?.runningShellCount).toBe(1)
  })

  it('still reads a footer with no box on screen, as before', () => {
    expect(parseClaudeRunningShellCount(['▶▶ auto mode on · 4 shells · ← for agents'])).toBe(4)
    expect(parseClaudeRunningShellCount([])).toBeNull()
  })
})
