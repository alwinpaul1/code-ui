import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { deriveBackgroundTasks, type BackgroundTask } from './mobile-background-tasks'
import { rowLiveTaskIds } from './mobile-native-chat-row-live-tasks'
import { toolRunProgress } from './mobile-native-chat-tool-run-progress'
import {
  BASH_CALL_UUID,
  BASH_MOVED_UUID,
  RUNNING_ROWS_AGENT_DESCRIPTION,
  RUNNING_ROWS_AGENT_ID,
  RUNNING_ROWS_SHELL_ID,
  agentRun,
  bashRunMovedToBackground,
  runningRowsMessages
} from './fixtures/claude-running-rows-2.1.296'

// Which running tasks a conversation row may sweep for, read off the real
// transcript of the 2026-10-11 recording (fixtures/claude-running-rows-2.1.296.ts).

const RECORDED_AT = Date.parse('2026-10-11T15:57:41Z')
type Row = NonNullable<AgentStatusEntry['subagents']>[number]
const rosterRow: Row = { id: RUNNING_ROWS_AGENT_ID, agentType: 'general-purpose', state: 'working', startedAt: Date.parse('2026-10-11T15:51:10Z') }
const working = (subagents: Row[]) => ({ state: 'working' as const, subagents })

function liveAt(throughUuid: string, hostStatus: ReturnType<typeof working> | null): ReadonlySet<string> {
  const { running } = deriveBackgroundTasks(runningRowsMessages(throughUuid), RECORDED_AT, hostStatus)
  return rowLiveTaskIds(running, { structuredRoster: false, hostStatus })
}

describe('the background agent "Fix status line usage figures"', () => {
  it("sweeps while Orca's roster lists it", () => {
    expect(liveAt(BASH_CALL_UUID, working([rosterRow])).has(RUNNING_ROWS_AGENT_ID)).toBe(true)
  })

  it('stops once the roster has dropped it', () => {
    expect(liveAt(BASH_CALL_UUID, working([])).has(RUNNING_ROWS_AGENT_ID)).toBe(false)
    expect(liveAt(BASH_CALL_UUID, working([{ ...rosterRow, state: 'idle' }])).has(RUNNING_ROWS_AGENT_ID)).toBe(false)
  })

  it("never sweeps on the transcript reader's word alone, which nothing would retire", () => {
    const { running } = deriveBackgroundTasks(runningRowsMessages(BASH_CALL_UUID), RECORDED_AT, null)
    expect(running.map((task) => task.id)).toContain(RUNNING_ROWS_AGENT_ID)
    expect(rowLiveTaskIds(running, { structuredRoster: false, hostStatus: null }).size).toBe(0)
  })
})

describe('the gate moved to the background', () => {
  it('sweeps while the pane has a host status to retire it', () => {
    expect(liveAt(BASH_MOVED_UUID, working([rosterRow])).has(RUNNING_ROWS_SHELL_ID)).toBe(true)
  })

  it('does not sweep with no host status at all', () => {
    expect(liveAt(BASH_MOVED_UUID, null).has(RUNNING_ROWS_SHELL_ID)).toBe(false)
  })
})

describe('the host structured roster', () => {
  it('vouches for everything it lists, and nothing when it lists nothing', () => {
    const task = (id: string, kind: BackgroundTask['kind']): BackgroundTask => ({ id, kind, title: id, status: 'running', startedAt: null, elapsedMs: null })
    const running = [task('w1', 'workflow'), task('a1', 'agent'), task('s1', 'shell')]
    expect([...rowLiveTaskIds(running, { structuredRoster: true, hostStatus: null })]).toEqual(['w1', 'a1', 's1'])
    expect(rowLiveTaskIds([], { structuredRoster: true, hostStatus: null }).size).toBe(0)
  })
})

describe('a run reading its own progress', () => {
  const inputs = { runningIds: new Set<string>(), confirmed: new Map<string, string>(), agentWorking: true }

  it('an empty run and a lone result never run', () => {
    expect(toolRunProgress([], inputs)).toBeNull()
    const lone: NativeChatBlock[] = [{ type: 'tool-result', output: 'Command running in background with ID: b3w804om8.' }]
    expect(toolRunProgress(lone, { ...inputs, liveTaskIds: new Set([RUNNING_ROWS_SHELL_ID]) })).toBeNull()
  })

  it('names the agent it launched while that agent is live', () => {
    expect(toolRunProgress(agentRun(), { ...inputs, agentWorking: false, liveTaskIds: new Set([RUNNING_ROWS_AGENT_ID]) })).toEqual({
      kind: 'agent',
      subject: RUNNING_ROWS_AGENT_DESCRIPTION
    })
  })

  it("does not take another run's live shell for its own", () => {
    expect(toolRunProgress(bashRunMovedToBackground(), { ...inputs, liveTaskIds: new Set(['bother000']) })).toBeNull()
  })

  it('reads a structured call as the lane does, not as an open transcript call', () => {
    const marked: NativeChatBlock[] = [{ type: 'tool-call', name: 'Bash', input: { command: 'ls' }, state: 'completed' }]
    expect(toolRunProgress(marked, inputs)).toBeNull()
  })
})
