// The shared reducer's and coalescer's own test files are vendored but never
// collected here — this fork's vitest root is `mobile/`. So the background-task
// half of Orca #18757/#18807/#19346/#19311 is pinned where the gate runs it.

import { describe, expect, it } from 'vitest'
import type { AgentJournalRenderItem } from '../../../src/shared/agent-session-journal-types'
import type {
  AgentSessionBackgroundTask,
  AgentSessionBackgroundTaskState,
  AgentSessionHistoryPage,
  AgentSessionSubscribeEvent
} from '../../../src/shared/agent-session-wire'
import { agentSessionBackgroundTasksEqual } from '../../../src/shared/agent-session-wire'
import {
  EMPTY_STRUCTURED_AGENT_SESSION,
  reduceStructuredAgentSession
} from '../../../src/shared/structured-agent-session-reducer'
import { createStructuredAgentSessionEventCoalescer } from '../../../src/shared/structured-agent-session-coalescer'

function item(id: string, sequence: number): AgentJournalRenderItem {
  return {
    itemId: id,
    revision: 1,
    sequence,
    observedAt: sequence,
    body: { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text: id }] }
  }
}

function hydrationPage(
  items: AgentJournalRenderItem[],
  backgroundTasks?: AgentSessionBackgroundTaskState | null
): AgentSessionHistoryPage {
  const oldest = items[0]?.sequence ?? 0
  const newest = items.at(-1)?.sequence ?? 0
  return {
    sessionId: 'session-a',
    epoch: 'epoch-a',
    direction: 'tail',
    items,
    removedItemIds: [],
    submissions: [],
    window: {
      oldest: items[0] ? { epoch: 'epoch-a', sequence: oldest } : null,
      newest: items.at(-1) ? { epoch: 'epoch-a', sequence: newest } : null,
      nextCursor: { epoch: 'epoch-a', sequence: oldest }
    },
    liveCursor: { epoch: 'epoch-a', sequence: newest },
    hasOlder: false,
    hasNewer: false,
    ...(backgroundTasks !== undefined ? { backgroundTasks } : {})
  }
}

function monitoring(tasks: AgentSessionBackgroundTask[]): AgentSessionBackgroundTaskState {
  return { state: 'monitoring', tasks, supportsTaskStop: true }
}

function seeded(backgroundTasks?: AgentSessionBackgroundTaskState | null) {
  return reduceStructuredAgentSession(EMPTY_STRUCTURED_AGENT_SESSION, {
    type: 'event',
    event: {
      type: 'snapshot',
      sessionId: 'session-a',
      fence: 1,
      page: hydrationPage([item('one', 1)]),
      ...(backgroundTasks !== undefined ? { backgroundTasks } : {})
    }
  })
}

function taskBatch(
  cursorSequence: number,
  backgroundTasks: AgentSessionBackgroundTaskState | null
): Extract<AgentSessionSubscribeEvent, { type: 'batch' }> {
  return {
    type: 'batch',
    sessionId: 'session-a',
    fence: 1,
    backgroundTasks,
    batch: {
      cursor: { epoch: 'epoch-a', sequence: cursorSequence },
      items: [],
      removedItemIds: [],
      submissions: []
    }
  }
}

describe('the background tasks a structured session is monitoring', () => {
  it('reach the phone with the snapshot that proves the session', () => {
    const tasks = monitoring([{ id: 'task-1', kind: 'agent', description: 'audit the docs' }])
    expect(seeded(tasks).backgroundTasks).toEqual(tasks)
  })

  it('reach the phone on a batch that carries no journal rows', () => {
    const state = seeded()
    const tasks = monitoring([{ id: 'task-1', kind: 'command', description: 'pnpm build' }])
    const updated = reduceStructuredAgentSession(state, {
      type: 'event',
      event: taskBatch(state.cursor!.sequence, tasks)
    })
    expect(updated.backgroundTasks).toEqual(tasks)
  })

  it('keep the transcript list identical while only a task ticks', () => {
    const state = seeded(monitoring([{ id: 'task-1', kind: 'agent', state: 'working' }]))
    const updated = reduceStructuredAgentSession(state, {
      type: 'event',
      event: taskBatch(
        state.cursor!.sequence,
        monitoring([{ id: 'task-1', kind: 'agent', state: 'waiting' }])
      )
    })
    expect(updated).not.toBe(state)
    expect(updated.backgroundTasks?.tasks?.[0]?.state).toBe('waiting')
    // A task edge must not hand the inverted FlashList a new `items` array; it
    // re-renders and re-runs the autoscroll for a change the list cannot see.
    expect(updated.items).toBe(state.items)
    expect(updated.submissions).toBe(state.submissions)
  })

  it('leave the session untouched when a re-publish repeats the same roster', () => {
    const state = seeded(monitoring([{ id: 'task-1', kind: 'monitor', description: 'watch logs' }]))
    const updated = reduceStructuredAgentSession(state, {
      type: 'event',
      event: taskBatch(
        state.cursor!.sequence,
        monitoring([{ id: 'task-1', kind: 'monitor', description: 'watch logs' }])
      )
    })
    expect(updated).toBe(state)
  })

  it('notice a settled sibling appearing beside a live task', () => {
    const live = monitoring([{ id: 'task-1', kind: 'agent', state: 'working' }])
    const state = seeded(live)
    const withSettled: AgentSessionBackgroundTaskState = {
      ...live,
      settledTasks: [{ id: 'task-0', kind: 'agent', state: 'done' }]
    }
    const updated = reduceStructuredAgentSession(state, {
      type: 'event',
      event: taskBatch(state.cursor!.sequence, withSettled)
    })
    expect(updated).not.toBe(state)
    expect(updated.backgroundTasks?.settledTasks).toHaveLength(1)
  })

  it('survive a tail refresh of the same epoch that reports none', () => {
    const tasks = monitoring([{ id: 'task-1', kind: 'workflow' }])
    const state = seeded(tasks)
    const refreshed = reduceStructuredAgentSession(state, {
      type: 'tail-page',
      page: hydrationPage([item('one', 1), item('two', 2)])
    })
    expect(refreshed.backgroundTasks).toEqual(tasks)
  })

  it('clear when the host says the roster is gone', () => {
    const state = seeded(monitoring([{ id: 'task-1', kind: 'agent' }]))
    const updated = reduceStructuredAgentSession(state, {
      type: 'event',
      event: taskBatch(state.cursor!.sequence, null)
    })
    expect(updated.backgroundTasks).toBeNull()
  })

  it('are not lost when two batches coalesce into one', () => {
    const emitted: AgentSessionSubscribeEvent[] = []
    const coalescer = createStructuredAgentSessionEventCoalescer((event) => emitted.push(event))
    coalescer.push(taskBatch(1, monitoring([{ id: 'task-1', kind: 'agent', state: 'working' }])))
    coalescer.push(taskBatch(2, monitoring([{ id: 'task-1', kind: 'agent', state: 'done' }])))
    coalescer.flush()
    expect(emitted).toHaveLength(1)
    const merged = emitted[0]
    expect(merged?.type === 'batch' && merged.backgroundTasks?.tasks?.[0]?.state).toBe('done')
    coalescer.dispose()
  })

  it('keep an earlier roster when the newer batch reports none', () => {
    const emitted: AgentSessionSubscribeEvent[] = []
    const coalescer = createStructuredAgentSessionEventCoalescer((event) => emitted.push(event))
    coalescer.push(taskBatch(1, monitoring([{ id: 'task-1', kind: 'agent' }])))
    const silent = taskBatch(2, null)
    delete silent.backgroundTasks
    coalescer.push(silent)
    coalescer.flush()
    const merged = emitted[0]
    expect(merged?.type === 'batch' && merged.backgroundTasks?.tasks?.[0]?.id).toBe('task-1')
    coalescer.dispose()
  })

  it('keeps only the latest ephemeral activity value', () => {
    const emitted: AgentSessionSubscribeEvent[] = []
    const coalescer = createStructuredAgentSessionEventCoalescer((event) => emitted.push(event))
    coalescer.push({
      ...taskBatch(1, monitoring([{ id: 'task-1', kind: 'agent' }])),
      activity: { turnId: 'turn-1', text: 'Thinking' }
    })
    coalescer.push({
      ...taskBatch(1, monitoring([{ id: 'task-1', kind: 'agent' }])),
      activity: { turnId: 'turn-1', text: 'Checking the result' }
    })
    coalescer.push({
      ...taskBatch(1, monitoring([{ id: 'task-1', kind: 'agent' }])),
      activity: null
    })
    coalescer.flush()
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({ activity: null })
    coalescer.dispose()
  })
})

describe('provider activity on a structured session', () => {
  it('projects ephemeral activity without changing transcript identity and clears it', () => {
    const initial = seeded()
    const active = reduceStructuredAgentSession(initial, {
      type: 'event',
      event: {
        ...taskBatch(initial.cursor!.sequence, null),
        activity: { turnId: 'turn-1', text: 'Checking the renderer' }
      }
    })
    expect(active.activity).toEqual({ turnId: 'turn-1', text: 'Checking the renderer' })
    expect(active.items).toBe(initial.items)

    const cleared = reduceStructuredAgentSession(active, {
      type: 'event',
      event: {
        ...taskBatch(active.cursor!.sequence, null),
        activity: null
      }
    })
    expect(cleared.activity).toBeNull()
    expect(cleared.items).toBe(active.items)
  })

  it('retains same-epoch activity across a newer journal tail refresh', () => {
    const active = reduceStructuredAgentSession(EMPTY_STRUCTURED_AGENT_SESSION, {
      type: 'event',
      event: {
        type: 'snapshot',
        sessionId: 'session-a',
        fence: 1,
        page: hydrationPage([item('first', 1)]),
        activity: { turnId: 'turn-1', text: 'Checking the renderer' }
      }
    })
    const refreshed = reduceStructuredAgentSession(active, {
      type: 'tail-page',
      page: hydrationPage([item('latest', 2)])
    })
    expect(refreshed.activity).toEqual({ turnId: 'turn-1', text: 'Checking the renderer' })
  })
})

describe('task-list equality on the wire', () => {
  it('separates a task whose state moved on', () => {
    expect(
      agentSessionBackgroundTasksEqual(
        [{ id: 'a', kind: 'agent', state: 'working' }],
        [{ id: 'a', kind: 'agent', state: 'done' }]
      )
    ).toBe(false)
  })

  it('separates a task whose usage grew', () => {
    expect(
      agentSessionBackgroundTasksEqual(
        [{ id: 'a', kind: 'agent', totalTokens: 100 }],
        [{ id: 'a', kind: 'agent', totalTokens: 200 }]
      )
    ).toBe(false)
  })

  it('holds two identical rosters equal', () => {
    expect(
      agentSessionBackgroundTasksEqual(
        [{ id: 'a', kind: 'agent', name: 'auditor', startedAt: 7 }],
        [{ id: 'a', kind: 'agent', name: 'auditor', startedAt: 7 }]
      )
    ).toBe(true)
  })
})
