// A foreground Agent-tool subagent started while a workflow runs must stay the
// session's own work. The lead's unanswered `Agent` call vouches for the first
// roster row that starts within 30 s of it and names no other agent type
// (mobile-background-task-memory.ts `callStarted`). The call names no
// `subagent_type`, so a workflow lane starting just after it took the vouch,
// and the real agent was then classed a reviewer and dropped from the count.
// Lane shape as Orca's hooks give it (Claude Code 2.1.284): SubagentStart
// carries only agent_id and agent_type.
import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry, AgentSubagentSnapshot } from '../../../src/shared/agent-status-types'
import type { WindowTaskEvidence } from './mobile-background-task-evidence'
import { EMPTY_SESSION_TASK_EVIDENCE, rememberTaskEvidence, type SessionTaskEvidence } from './mobile-background-task-memory'

const at = (clock: string) => Date.parse(`2026-09-30T${clock}Z`)
const CALL_AT = at('10:00:10.000')
const WINDOW: WindowTaskEvidence = {
  ownAgentIds: [],
  retiredTaskIds: [],
  pendingAgentCalls: [{ key: 'agent-call-1', at: CALL_AT, subagentType: null }],
  oldestAt: at('09:59:00.000')
}
const LANE: AgentSubagentSnapshot = { id: 'a7f3c19d20be4a611', agentType: 'workflow-subagent', state: 'working', startedAt: at('10:00:11.000') }
const FOREGROUND: AgentSubagentSnapshot = { id: 'a0b1c2d3e4f5a6b7c', agentType: 'general-purpose', state: 'working', startedAt: at('10:00:12.000') }

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

function see(previous: SessionTaskEvidence, status: AgentStatusEntry): SessionTaskEvidence {
  return rememberTaskEvidence(previous, { window: WINDOW, settled: true, agentStatus: status, onScreenShellCount: null, now: at('10:01:00.000') })
}

describe('a foreground agent started during a workflow', () => {
  it('stays counted: the workflow lane that started first does not take the Agent call’s vouch', () => {
    const first = see(EMPTY_SESSION_TASK_EVIDENCE, hookRow([]))
    const next = see(first, hookRow([LANE, FOREGROUND]))
    expect(next.ownAgentIds).toContain(FOREGROUND.id)
    expect(next.ownAgentIds).not.toContain(LANE.id)
  })

  it('still vouches for a lone foreground agent (the ordinary case is unchanged)', () => {
    const first = see(EMPTY_SESSION_TASK_EVIDENCE, hookRow([]))
    expect(see(first, hookRow([FOREGROUND])).ownAgentIds).toEqual([FOREGROUND.id])
  })
})
