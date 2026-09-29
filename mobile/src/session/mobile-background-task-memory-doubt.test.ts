// The benefit of the doubt a roster row the loaded window never showed
// launched keeps across Orca's title stand-in, rule by rule
// (mobile-background-task-memory.ts). The chat-level cases are in
// running-tasks-through-orca-stand-in.test.ts.
import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry, AgentSubagentSnapshot } from '../../../src/shared/agent-status-types'
import type { WindowTaskEvidence } from './mobile-background-task-evidence'
import { EMPTY_SESSION_TASK_EVIDENCE, rememberTaskEvidence, type SessionTaskEvidence } from './mobile-background-task-memory'

const at = (clock: string) => Date.parse(`2026-09-29T${clock}Z`)
const DOUBTED = 'a441049d174b06e5e'
const TEAMMATE = 'areviewer-1f2e3d4c'
const WINDOW: WindowTaskEvidence = { ownAgentIds: [], retiredTaskIds: [], pendingAgentCalls: [], oldestAt: at('09:59:00.000') }
const row = (id: string, startedAt: string): AgentSubagentSnapshot => ({ id, state: 'working', startedAt: at(startedAt), agentType: 'general-purpose' })

const hookRow = (rows: AgentSubagentSnapshot[]): AgentStatusEntry =>
  ({
    state: 'working',
    prompt: 'go',
    updatedAt: at('10:00:00.000'),
    stateStartedAt: at('09:59:30.000'),
    paneKey: 'tab-1:leaf-1',
    agentType: 'claude',
    stateHistory: [{ state: 'done', prompt: '', startedAt: at('09:58:00.000') }],
    subagents: rows
  }) as AgentStatusEntry
/** Orca's title stand-in: no roster at all. */
const standIn = (): AgentStatusEntry =>
  ({
    state: 'done',
    prompt: '',
    updatedAt: at('10:00:20.000'),
    stateStartedAt: at('10:00:20.000'),
    paneKey: 'tab-1:leaf-1',
    stateHistory: [],
    agentType: 'claude',
    tabId: 'tab-1'
  }) as AgentStatusEntry

function see(previous: SessionTaskEvidence, status: AgentStatusEntry | null): SessionTaskEvidence {
  return rememberTaskEvidence(previous, { window: WINDOW, settled: true, agentStatus: status, onScreenShellCount: null, now: at('10:01:00.000') })
}

describe('the benefit of the doubt through a stand-in', () => {
  it('keeps the same lists and starts when the same roster is seen again, so nothing recounts', () => {
    const first = see(EMPTY_SESSION_TASK_EVIDENCE, hookRow([row(DOUBTED, '09:40:00.000')]))
    const again = see(first, hookRow([row(DOUBTED, '09:40:00.000')]))
    expect(again.preexistingAgentIds).toBe(first.preexistingAgentIds)
    expect(again.doubtStartedAt).toBe(first.doubtStartedAt)
    expect(again.placedAgentIds).toBe(first.placedAgentIds)
  })

  it('keeps the doubt through a stand-in, which says nothing about the roster', () => {
    const first = see(EMPTY_SESSION_TASK_EVIDENCE, hookRow([row(DOUBTED, '09:40:00.000')]))
    const through = see(see(first, standIn()), hookRow([row(DOUBTED, '09:40:00.000')]))
    expect(through.preexistingAgentIds).toEqual([DOUBTED])
  })

  it('drops the doubt for a row back with another start after a stand-in hid the roster', () => {
    const first = see(EMPTY_SESSION_TASK_EVIDENCE, hookRow([row(DOUBTED, '09:40:00.000')]))
    const resumed = see(see(first, standIn()), hookRow([row(DOUBTED, '10:00:30.000')]))
    expect(resumed.preexistingAgentIds).toEqual([])
  })

  it('keeps the doubt for a row Orca re-created with another start while the phone saw every hook row', () => {
    const first = see(EMPTY_SESSION_TASK_EVIDENCE, hookRow([row(DOUBTED, '09:40:00.000')]))
    const recreated = see(see(first, null), hookRow([row(DOUBTED, '10:00:30.000')]))
    expect(recreated.preexistingAgentIds).toEqual([DOUBTED])
    // Its new start is the one a later stand-in is judged against.
    const later = see(see(recreated, standIn()), hookRow([row(DOUBTED, '10:00:30.000')]))
    expect(later.preexistingAgentIds).toEqual([DOUBTED])
  })

  it('keeps a teammate’s doubt across a stand-in: its row keeps its start through a stop', () => {
    const first = see(EMPTY_SESSION_TASK_EVIDENCE, hookRow([row(TEAMMATE, '09:40:00.000')]))
    const back = see(see(first, standIn()), hookRow([row(TEAMMATE, '10:00:30.000')]))
    expect(back.preexistingAgentIds).toEqual([TEAMMATE])
  })

  it('judges only the hook row right after the stand-in: the next one is watched again', () => {
    const first = see(EMPTY_SESSION_TASK_EVIDENCE, hookRow([row(DOUBTED, '09:40:00.000')]))
    const after = see(see(first, standIn()), hookRow([row(DOUBTED, '09:40:00.000')]))
    expect(after.rosterUnseen).toBe(false)
    expect(see(after, hookRow([row(DOUBTED, '10:00:30.000')])).preexistingAgentIds).toEqual([DOUBTED])
  })

  // The fifth review pass: snapshots with no status between the stand-in and
  // the next hook row carry the flag, and that hook row still clears it.
  it('judges the first hook row after a stand-in even with statuses missing between, then clears', () => {
    const first = see(EMPTY_SESSION_TASK_EVIDENCE, hookRow([row(DOUBTED, '09:40:00.000')]))
    const gap = see(see(see(first, standIn()), null), null)
    expect(gap.rosterUnseen).toBe(true)
    const resumed = see(gap, hookRow([row(DOUBTED, '10:00:30.000')]))
    expect(resumed.preexistingAgentIds).toEqual([])
    expect(resumed.rosterUnseen).toBe(false)
  })

  it('carries nothing when there is no roster yet', () => {
    const empty = see(EMPTY_SESSION_TASK_EVIDENCE, standIn())
    expect(empty.preexistingAgentIds).toBeNull()
    expect(empty.doubtStartedAt).toEqual({})
  })
})
