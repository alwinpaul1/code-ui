import { describe, expect, it } from 'vitest'
import type { AgentSessionBackgroundTaskState } from '../../../src/shared/agent-session-wire'
import { projectStructuredBackgroundTasks } from './mobile-structured-background-tasks'

const NOW = 1_800_000_000_000

function roster(
  overrides: Partial<AgentSessionBackgroundTaskState> = {}
): AgentSessionBackgroundTaskState {
  return { state: 'monitoring', tasks: [], ...overrides }
}

describe('the background tasks a structured tab reads off the wire', () => {
  it('defers to the transcript reader while the host has reported no roster', () => {
    expect(projectStructuredBackgroundTasks(undefined, NOW)).toBeNull()
  })

  it('says nothing is running once the host clears the roster', () => {
    // Not the same as never reporting: the transcript reader must NOT take over
    // and re-list a task the host has just said is gone.
    expect(projectStructuredBackgroundTasks(null, NOW)).toEqual({ running: [], finished: [] })
  })

  it('lists a live task with the description the host gave it', () => {
    const projected = projectStructuredBackgroundTasks(
      roster({
        tasks: [
          {
            id: 'task-1',
            kind: 'agent',
            description: 'audit the docs',
            state: 'working',
            startedAt: NOW - 92_000
          }
        ]
      }),
      NOW
    )
    expect(projected?.running).toEqual([
      {
        id: 'task-1',
        kind: 'agent',
        title: 'audit the docs',
        status: 'running',
        startedAt: NOW - 92_000,
        elapsedMs: 92_000
      }
    ])
  })

  it('falls back to the provider-reported name, then to the kind', () => {
    const projected = projectStructuredBackgroundTasks(
      roster({
        tasks: [
          { id: 'a', kind: 'agent', name: 'doc-auditor' },
          { id: 'b', kind: 'monitor' }
        ]
      }),
      NOW
    )
    expect(projected?.running.map((task) => task.title)).toEqual(['doc-auditor', 'Monitor'])
  })

  it('keeps a command apart from a monitor instead of calling both shells', () => {
    const projected = projectStructuredBackgroundTasks(
      roster({
        tasks: [
          { id: 'a', kind: 'command', description: 'pnpm build' },
          { id: 'b', kind: 'monitor', description: 'watch logs' },
          { id: 'c', kind: 'workflow', description: 'nightly' },
          { id: 'd', kind: 'unknown', description: 'something' }
        ]
      }),
      NOW
    )
    expect(projected?.running.map((task) => task.kind)).toEqual([
      'shell',
      'monitor',
      'workflow',
      'unknown'
    ])
  })

  it('shows no stopwatch for a task the host never dated', () => {
    const projected = projectStructuredBackgroundTasks(
      roster({ tasks: [{ id: 'a', kind: 'command', description: 'pnpm build' }] }),
      NOW
    )
    expect(projected?.running[0]?.startedAt).toBeNull()
    expect(projected?.running[0]?.elapsedMs).toBeNull()
  })

  it('reads a settled sibling as finished, and a blocked one as failed', () => {
    const projected = projectStructuredBackgroundTasks(
      roster({
        tasks: [{ id: 'live', kind: 'agent', state: 'working' }],
        settledTasks: [
          { id: 'ok', kind: 'agent', description: 'reviewed', state: 'done', startedAt: NOW - 5000 },
          { id: 'bad', kind: 'command', description: 'pnpm test', state: 'blocked' }
        ]
      }),
      NOW
    )
    expect(projected?.running.map((task) => task.id)).toEqual(['live'])
    expect(projected?.finished.map((task) => [task.id, task.status])).toEqual([
      ['ok', 'completed'],
      ['bad', 'failed']
    ])
    // A finished row never draws a clock — the work is not still counting.
    expect(projected?.finished[0]?.elapsedMs).toBeNull()
  })

  it('survives a host that sends the state alone with no task list', () => {
    expect(projectStructuredBackgroundTasks(roster({ tasks: undefined }), NOW)).toEqual({
      running: [],
      finished: []
    })
  })
})
