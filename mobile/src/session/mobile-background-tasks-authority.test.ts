import { describe, expect, it } from 'vitest'
import { deriveBackgroundTasks } from './mobile-background-tasks'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

const T0 = Date.UTC(2026, 8, 10, 11, 0, 0)

function launch(id: string, description: string, at: number): NativeChatMessage[] {
  return [
    {
      id: `call-${id}`,
      role: 'assistant',
      timestamp: at,
      source: 'transcript',
      blocks: [
        {
          type: 'tool-call',
          name: 'Bash',
          input: { command: 'sleep 600', description, run_in_background: true }
        }
      ]
    } as NativeChatMessage,
    {
      id: `result-${id}`,
      role: 'user',
      timestamp: at,
      source: 'transcript',
      blocks: [
        {
          type: 'tool-result',
          output: `Command running in background with ID: ${id}. Output is being written to: /tmp/${id}.output.`
        }
      ]
    } as NativeChatMessage
  ]
}

describe('who decides which background tasks are running', () => {
  it('drops a task the agent no longer lists, however the transcript reads', () => {
    // Measured 2026-09-10 against this project's own 40 MB transcript: reading
    // the transcript alone reported 36 running when 3 were. A completion that
    // lands mid-turn is written as a record the transcript reader never
    // surfaces, so nothing retired them. The agent's own Stop hook knows.
    const messages = [...launch('bAAA', 'Old build', T0), ...launch('bBBB', 'Live build', T0)]
    const now = T0 + 60_000

    const derived = deriveBackgroundTasks(messages, now, null, { runningTaskIds: ['bBBB'] })

    expect(derived.running.map((task) => task.id)).toEqual(['bBBB'])
    expect(derived.finished.map((task) => task.id)).toContain('bAAA')
  })

  it('clears the row when the agent says nothing is running', () => {
    const messages = launch('bAAA', 'Old build', T0)

    const derived = deriveBackgroundTasks(messages, T0 + 60_000, null, { runningTaskIds: [] })

    expect(derived.running).toEqual([])
  })

  it('keeps guessing while the agent has not answered, so a live turn still shows work', () => {
    // The Stop hook only speaks at the end of a turn. Until then the
    // transcript is all there is, and a task launched this turn is running.
    const messages = launch('bAAA', 'Live build', T0)

    const derived = deriveBackgroundTasks(messages, T0 + 60_000, null, {})

    expect(derived.running.map((task) => task.id)).toEqual(['bAAA'])
  })

  it('shows a task the agent reports that the loaded transcript never showed, once bg= vouches for it', () => {
    // Launched before the page the phone holds, or paginated out of it: the
    // status line's `bg=` reads the same transcript 4 MiB further back and is
    // the launch record the window lacks.
    const derived = deriveBackgroundTasks([], T0 + 60_000, null, {
      runningTaskIds: ['bZZZ'],
      launchedTaskIds: ['bZZZ']
    })

    expect(derived.running.map((task) => task.id)).toEqual(['bZZZ'])
  })

  it('does not show a run= id that nothing ever launched', () => {
    // 2026-09-12: the Stop payload calls an idle teammate `running`, and no
    // record anywhere launches a teammate as a task. Four of them read as
    // "4 running tasks" on the phone while the desk showed none.
    const derived = deriveBackgroundTasks([], T0 + 60_000, null, { runningTaskIds: ['tma4w24hz'] })

    expect(derived.running).toEqual([])
  })

  it('still retires a task the beacon already reported finished', () => {
    const messages = launch('bAAA', 'Old build', T0)

    const derived = deriveBackgroundTasks(messages, T0 + 60_000, null, {
      finishedTaskIds: ['bAAA'],
      runningTaskIds: ['bAAA']
    })

    // A completion the agent has already written outranks a roster that has
    // not caught up; the opposite order would resurrect a finished task.
    expect(derived.running).toEqual([])
  })
})
