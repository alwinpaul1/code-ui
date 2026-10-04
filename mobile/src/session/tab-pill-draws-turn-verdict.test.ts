import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import { agentDotState } from '../worktree/agent-row-display'
import { tabDotStateAfterLeadTurn } from './session-tab-activity'

// The tab pill (TabActivityBadge in MobileSessionHeader.tsx) draws the desktop tab's verdict marks
// once a turn ends: the muted dot after the user's Stop, red for a failure, amber for an end the
// host could not confirm. Orca v1.4.220's tab does the same: TerminalTabLeadingIcon.tsx:71-79 draws
// `terminalTabActivityToAgentDotState` (terminal-tab-activity-status.ts:240-248 passes
// failed/interrupted/unconfirmed), fed by `resolveWorktreeStatus` (worktree-status.ts:216-237) from
// `applyAgentPaneActivityFlags` (agent-pane-activity-flags.ts:20-35, `agentVerdictDisplayMark`).
//
// The pill still strips the legacy `interrupted` flag (since 41060f849, 2026-09-11), so a row that
// carries only that flag, with no `mainAgent`, still draws the check. The desktop tab reads that
// flag too (agentMainAgentVerdict), so that one case is not parity: a 1.4.220 host sends it for an
// OpenCode run a SIGINT ended (opencode-run-lifetime-status.ts:86), and hosts before `mainAgent`
// send it for every Stop.

const HEADER = readFileSync(join(__dirname, 'MobileSessionHeader.tsx'), 'utf8')

/** The header's source with its comments taken out, so the check below reads code, not prose. */
function headerCode(): string {
  return HEADER.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const PILL_EXPRESSION =
  "tabDotStateAfterLeadTurn(status ? agentDotState({ ...status, interrupted: false }, now) : 'idle', leadTurnEnded)"

/** The pill's own expression, as PILL_EXPRESSION spells it in MobileSessionHeader.tsx. */
function pillDotState(status: AgentStatusEntry | null, now: number, leadTurnEnded = false) {
  return tabDotStateAfterLeadTurn(
    status ? agentDotState({ ...status, interrupted: false }, now) : 'idle',
    leadTurnEnded
  )
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
  it('is drawn by the expression this test mirrors', () => {
    expect(headerCode()).toContain(PILL_EXPRESSION)
  })

  it("draws the desktop tab's verdict marks: muted after a Stop, red for a failure, amber when unconfirmed", () => {
    expect(pillDotState(endedRow('cancellation'), 2_000)).toBe('interrupted')
    expect(pillDotState(endedRow('failure'), 2_000)).toBe('failed')
    expect(pillDotState(endedRow('unconfirmed'), 2_000)).toBe('unconfirmed')
    // Each mark outlives the lead-turn rule, which only turns a spinner into the heartbeat.
    expect(pillDotState(endedRow('failure'), 2_000, true)).toBe('failed')
  })

  it('still draws the check for a row that carries only the legacy Stop flag', () => {
    expect(pillDotState(endedRow(null, true), 2_000)).toBe('done')
  })
})
