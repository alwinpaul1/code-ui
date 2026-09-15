import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentSessionBackgroundTaskState } from '../../../src/shared/agent-session-wire'
import { useMobileRunningTaskCount } from './use-mobile-running-task-count'

let latest = -1
function Probe({ roster }: { roster: AgentSessionBackgroundTaskState | null }) {
  latest = useMobileRunningTaskCount({ messages: [], hostBackgroundTasks: roster })
  return null
}

function roster(
  tasks: AgentSessionBackgroundTaskState['tasks']
): AgentSessionBackgroundTaskState {
  return { state: 'monitoring', supportsTaskStop: true, tasks, settledTasks: [] }
}

// 2026-09-15 regression review: this hook feeds the running-tasks number the
// user reads, and nothing in the repo tested it — including when the agent
// filter was added to its host-roster branch.
describe('the running-tasks number under the last message', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(state: AgentSessionBackgroundTaskState | null): number {
    act(() => {
      renderer = create(createElement(Probe, { roster: state }))
    })
    return latest
  }

  // Every kind the host reports is background work the row is about — shells,
  // subagents and monitors alike. They are listed as one flat run in the sheet
  // (the per-kind headings came off on 2026-09-15), so the number beside it
  // counts the same set.
  it('counts every running task the host reports, subagents included', () => {
    expect(
      render(
        roster([
          { id: 's1', kind: 'command', description: 'pnpm test', state: 'working' },
          { id: 'a1', kind: 'agent', description: 'Review the diff', state: 'working' },
          { id: 'a2', kind: 'agent', description: 'Audit the notes', state: 'working' }
        ])
      )
    ).toBe(3)
  })

  // A host that answers "none" is an answer, not a reason to go and guess from
  // the transcript — which is why this branch is not a `||` fallthrough.
  it('takes an empty roster as the answer rather than falling back', () => {
    expect(render(roster([]))).toBe(0)
  })

  it('reads no roster at all as nothing running on an empty transcript', () => {
    expect(render(null)).toBe(0)
  })
})
