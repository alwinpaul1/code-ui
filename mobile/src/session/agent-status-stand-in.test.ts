// What the task readers read while Orca stands in a pane's status, rule by
// rule (agent-status-stand-in.ts). The chat-level story, through the real
// controller, is running-tasks-through-orca-stand-in.test.ts.
import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import { isOrcaStandIn, readTaskStatus, type TaskStatusWatch } from './agent-status-stand-in'

const SESSION = { key: 'session_id', id: '5f2d8c61-3b0e-4f7a-9c44-2e61d0a9b7c3' }
const row = (fields: Partial<AgentStatusEntry> = {}): AgentStatusEntry =>
  ({
    state: 'working',
    workingMode: 'monitoring',
    prompt: 'start the server',
    updatedAt: 2_000,
    stateStartedAt: 1_000,
    paneKey: 'tab-1:leaf-1',
    agentType: 'claude',
    tabId: 'tab-1',
    terminalTitle: '✳ Server',
    stateHistory: [{ state: 'done', prompt: 'before', startedAt: 500 }],
    subagents: [{ id: 'a1', state: 'working', startedAt: 1_500 }],
    providerSession: SESSION,
    ...fields
  }) as AgentStatusEntry
/** Orca 1.4.216's title stand-in: every field it can carry, and no other. */
const standIn = (fields: Partial<AgentStatusEntry> = {}): AgentStatusEntry =>
  ({
    state: 'done',
    prompt: '',
    updatedAt: 2_300,
    stateStartedAt: 2_300,
    paneKey: 'tab-1:leaf-1',
    stateHistory: [],
    agentType: 'claude',
    terminalHandle: 'term-1',
    worktreeId: 'repo::/w',
    tabId: 'tab-1',
    terminalTitle: '✳ Server',
    providerSession: SESSION,
    ...fields
  }) as AgentStatusEntry

/** Feeds statuses in order, as renders do, and returns what the task readers
 *  read of the last one. */
function readAll(statuses: readonly (AgentStatusEntry | null)[], watching: readonly boolean[] = []): AgentStatusEntry | null {
  let watch: TaskStatusWatch = null
  let read: AgentStatusEntry | null = null
  statuses.forEach((status, index) => {
    const next = readTaskStatus(watch, status, watching[index] ?? true)
    watch = next.watch
    read = next.read
  })
  return read
}

describe('the stand-in’s shape', () => {
  it('is every field Orca’s title stand-in carries, and nothing else', () => {
    expect(isOrcaStandIn(standIn())).toBe(true)
    expect(isOrcaStandIn(standIn({ state: 'working' }))).toBe(true)
  })

  it.each<[string, Partial<AgentStatusEntry>]>([
    ['a prompt', { prompt: 'go' }],
    ['a history', { stateHistory: [{ state: 'done', prompt: '', startedAt: 1 }] }],
    ['a roster, even an empty one', { subagents: [] }],
    ['a working mode', { workingMode: 'monitoring' }],
    ['a tool', { toolName: 'Bash' }],
    ['a session boundary', { sessionBoundary: true }],
    ['a reply', { lastAssistantMessage: 'done' }]
  ])('is not a status that carries %s: a hook row', (_label, fields) => {
    expect(isOrcaStandIn(standIn(fields))).toBe(false)
  })
})

describe('what the task readers read through a stand-in', () => {
  it('reads the pane’s last hook row through a stand-in the phone watched arrive after it', () => {
    const last = row()
    expect(readAll([row({ updatedAt: 1_900 }), last, standIn()])).toBe(last)
    expect(readAll([last, standIn(), standIn({ state: 'working', updatedAt: 2_900 })])).toBe(last)
  })

  it('reads a hook row after the stand-in as it comes', () => {
    const after = row({ subagents: undefined, updatedAt: 3_000 })
    expect(readAll([row(), standIn(), after])).toBe(after)
  })

  it('reads the stand-in as it comes on the first status the chat reads', () => {
    const first = standIn()
    expect(readAll([first])).toBe(first)
  })

  it.each([
    ['nothing (a snapshot with no status)', [row(), null, standIn()], []],
    ['a gap in the watch', [row(), row(), standIn()], [true, false, true]],
    ['another pane', [row(), row({ paneKey: 'tab-2:leaf-1' }), standIn()], []]
  ])('reads the stand-in as it comes after %s', (_label, statuses, watching) => {
    const statusList = statuses as (AgentStatusEntry | null)[]
    expect(readAll(statusList, watching as boolean[])).toBe(statusList.at(-1))
  })

  it.each([
    ['a row with no prompt and no history (a headless host)', row({ prompt: '', stateHistory: [] })],
    ['another session’s row', row({ providerSession: { key: 'session_id', id: 'another' } })],
    ['another agent’s row', row({ agentType: 'codex' })]
  ])('reads the stand-in as it comes after %s', (_label, before) => {
    const after = standIn()
    expect(readAll([before, after])).toBe(after)
  })

  it('reads Orca’s status for a pane its agent left as it comes: it copies none of the row’s identity', () => {
    const left = standIn({ terminalHandle: undefined, worktreeId: undefined, tabId: undefined, terminalTitle: undefined })
    expect(readAll([row(), left])).toBe(left)
  })

  it('reads a status with no pane key as it comes', () => {
    const bare = standIn({ paneKey: '' })
    expect(readAll([row({ paneKey: '' }), bare])).toBe(bare)
  })

  it('reads nothing as nothing', () => {
    expect(readAll([row(), null])).toBeNull()
    expect(readAll([])).toBeNull()
  })
})
