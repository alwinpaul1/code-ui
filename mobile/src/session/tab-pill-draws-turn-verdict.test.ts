import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import { tabPillDotState } from './session-tab-activity'

// The tab pill (TabActivityBadge in MobileSessionHeader.tsx) draws the desktop tab's verdict marks
// once a turn ends: the muted dot after the user's Stop, red for a failure, amber for an end the
// host could not confirm. Orca v1.4.220's tab does the same: TerminalTabLeadingIcon.tsx:71-79 draws
// `terminalTabActivityToAgentDotState` (terminal-tab-activity-status.ts:240-248 passes
// failed/interrupted/unconfirmed), fed by `resolveWorktreeStatus` (worktree-status.ts:216-237) from
// `applyAgentPaneActivityFlags` (agent-pane-activity-flags.ts:20-35, `agentVerdictDisplayMark`).
//
// The pill reads a row that carries only the legacy `interrupted` flag, with no `mainAgent`, as the
// desktop tab does: through the verdict (agentMainAgentVerdict, mirrored by agent-row-display.ts and
// pinned to it by its parity test), which takes the flag on a done row as a user's Stop. A 1.4.220
// host sends such a row for an OpenCode run a SIGINT ended (opencode-run-lifetime-status.ts:86), and
// hosts before `mainAgent` send one for every Stop. From 2026-09-11 (41060f849) to 2026-10-04 the
// pill stripped the flag and drew the check there.

const HEADER = readFileSync(join(__dirname, 'MobileSessionHeader.tsx'), 'utf8')

/** The header's source with its comments taken out, so the check below reads code, not prose. */
function headerCode(): string {
  return HEADER.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const PILL_EXPRESSION = 'tabPillDotState(status, now, leadTurnEnded)'

function pillDotState(status: AgentStatusEntry | null, now: number, leadTurnEnded = false) {
  return tabPillDotState(status, now, leadTurnEnded)
}

// The settled row a 1.4.217..1.4.220 host publishes after a Claude terminal turn ends
// (server-status-inference.ts inferInterrupt for a Stop: `interrupted: true` beside
// `mainAgent: { state: 'done', outcome: 'cancellation' }`).
function endedRow(
  outcome: 'cancellation' | 'failure' | 'unconfirmed' | null,
  interrupted = outcome === 'cancellation'
): AgentStatusEntry {
  return {
    state: 'done',
    prompt: 'fix the tests',
    agentType: 'claude',
    ...(interrupted ? { interrupted: true } : {}),
    ...(outcome ? { mainAgent: { state: 'done', outcome, stateStartedAt: 1_000 } } : {}),
    stateStartedAt: 1_000,
    updatedAt: 1_000,
    paneKey: 'tab-1:pane-1',
    stateHistory: []
  } as unknown as AgentStatusEntry
}

describe('the tab pill after a turn ends', () => {
  it('is drawn by the function this test calls', () => {
    expect(headerCode()).toContain(PILL_EXPRESSION)
  })

  it("draws the desktop tab's verdict marks: muted after a Stop, red for a failure, amber when unconfirmed", () => {
    expect(pillDotState(endedRow('cancellation'), 2_000)).toBe('interrupted')
    expect(pillDotState(endedRow('failure'), 2_000)).toBe('failed')
    expect(pillDotState(endedRow('unconfirmed'), 2_000)).toBe('unconfirmed')
    // Each mark outlives the lead-turn rule, which only turns a spinner into the heartbeat.
    expect(pillDotState(endedRow('failure'), 2_000, true)).toBe('failed')
  })

  it('draws a row that carries only the legacy Stop flag interrupted, as the desktop tab does', () => {
    expect(pillDotState(endedRow(null, true), 2_000)).toBe('interrupted')
    // The flag marks only a row that is itself done: live subagents after the Stop still read working.
    expect(pillDotState({ ...endedRow(null, true), state: 'working' }, 2_000)).toBe('working')
    expect(pillDotState(null, 2_000)).toBe('idle')
  })

  // The pill's fill and its dot's tone table come from tab-pill-surface.ts, and
  // AgentStateDot.verdict-tones.test.tsx measures every dot through those two functions on every
  // fill the pill has. This pins that the header draws through them and not a copy of them.
  it("draws its fill and its dot's tones through the functions the contrast test measures", () => {
    expect(headerCode()).toContain('backgroundColor: tabPillBackground(colors, active, pressed)')
    expect(headerCode()).toContain('{...tabPillDotSurface(active, isDark)}')
  })
})
