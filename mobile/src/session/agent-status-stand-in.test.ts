// What the task readers read while Orca stands in a pane's status, rule by
// rule (agent-status-stand-in.ts). The chat-level story, through the real
// controller, is running-tasks-through-orca-stand-in.test.ts.
import { createElement, StrictMode, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import {
  isOrcaStandIn,
  readTaskStatus,
  useTaskReaderStatus,
  type TaskStatusWatch
} from './agent-status-stand-in'

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

/** Orca's turn end on the tab: background work outlived the lead's turn. */
const GATED = 2_100

/** Feeds statuses in order, as renders do, and returns what the task readers
 *  read of the last one. */
function readAll(
  statuses: readonly (AgentStatusEntry | null)[],
  watching: readonly boolean[] = [],
  turnCompletedAt: number | null = GATED
): AgentStatusEntry | null {
  let watch: TaskStatusWatch = null
  let read: AgentStatusEntry | null = null
  statuses.forEach((status, index) => {
    const next = readTaskStatus(watch, status, watching[index] ?? true, turnCompletedAt)
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

  // The row the phone last saw is often the turn's last tool row, not the
  // Stop row: through a `done` only Orca's turn end says work outlived the turn.
  it('reads a done stand-in as it comes when Orca carries no turn end on the tab', () => {
    const idle = standIn()
    expect(readAll([row({ workingMode: undefined, toolName: 'Read' }), idle], [], null)).toBe(idle)
  })

  // Orca 1.4.217 (#22452, #22476): a cancelled Stop beside a running shell publishes a row that stays
  // `working`/`monitoring` with NO turn stamp (a cancelled turn earns none), and says on the row that
  // the lead itself is done: `mainAgent: { state: 'done', outcome: 'cancellation', stateStartedAt }`
  // (the shape agent-hook-listener-claude-turn-state.test.ts pins for the vendored listener).
  describe('a lead the row itself says is done while its work runs', () => {
    const leadDone = (outcome?: 'cancellation') => ({
      mainAgent: { state: 'done' as const, ...(outcome ? { outcome } : {}), stateStartedAt: 2_050 }
    })

    it('reads the row through a done stand-in after a cancel, though Orca stamped no turn end', () => {
      const cancelled = row(leadDone('cancellation'))
      expect(readAll([cancelled, standIn()], [], null)).toBe(cancelled)
    })

    it('reads the row through a done stand-in when the lead is done and the stamp is absent', () => {
      const settled = row(leadDone())
      expect(readAll([settled, standIn()], [], null)).toBe(settled)
    })

    it('still reads a lead that is at work as a tool row, not what outlived the turn', () => {
      const idle = standIn()
      const working = row({ mainAgent: { state: 'working', stateStartedAt: 2_050 } })
      expect(readAll([working, idle], [], null)).toBe(idle)
    })

    it('does not keep a row that says everything is done', () => {
      const idle = standIn()
      const finished = row({ state: 'done', workingMode: undefined, ...leadDone() })
      expect(readAll([finished, idle], [], null)).toBe(idle)
    })
  })

  it('reads the row through a working stand-in with no turn end: the lead is still at it', () => {
    const last = row({ workingMode: undefined })
    expect(readAll([last, standIn({ state: 'working' })], [], null)).toBe(last)
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

describe('the task readers’ status under React', () => {
  let push: ((status: AgentStatusEntry) => void) | null = null
  let read: AgentStatusEntry | null = null
  function Reader({ initial, turnCompletedAt }: { initial: AgentStatusEntry; turnCompletedAt: number | null }): null {
    const [status, setStatus] = useState(initial)
    push = setStatus
    read = useTaskReaderStatus(status, true, turnCompletedAt)
    return null
  }
  function mount(initial: AgentStatusEntry, turnCompletedAt: number | null = GATED, strict = false): ReactTestRenderer {
    let renderer: ReactTestRenderer | null = null
    const reader = createElement(Reader, { initial, turnCompletedAt })
    act(() => {
      renderer = create(strict ? createElement(StrictMode, null, reader) : reader)
    })
    return renderer!
  }

  it('reads the committed row through a stand-in under StrictMode’s double render', () => {
    const first = row()
    const renderer = mount(first, GATED, true)
    act(() => push!(standIn()))
    expect(read).toBe(first)
    act(() => renderer.unmount())
  })

  it('reads the stand-in as it comes after a remount: the watch starts empty', () => {
    const before = mount(row())
    act(() => before.unmount())
    const idle = standIn()
    const renderer = mount(idle)
    expect(read).toBe(idle)
    act(() => renderer.unmount())
  })

  // A limit, pinned: a row React never renders is never watched. Two
  // snapshots in one render (a burst after a stalled JS thread) hide the row
  // that dropped an agent. Through a `done` with no turn end on the tab the
  // stand-in is read as it comes all the same (the review of 09aa69a0).
  it('reads a done stand-in as it comes over a row React batched away, when Orca carries no turn end', () => {
    const renderer = mount(row(), null)
    act(() => {
      push!(row({ subagents: undefined, updatedAt: 2_200 }))
      push!(standIn())
    })
    expect(read?.subagents ?? []).toEqual([])
    act(() => renderer.unmount())
  })
})
