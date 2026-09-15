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

  // The user's instruction, 2026-09-15: subagents are not background work the
  // row is about. The count has to drop them exactly as the sheet does, or the
  // number and the list it opens disagree.
  it('does not count the agent\'s own subagents', () => {
    expect(
      render(
        roster([
          { id: 's1', kind: 'command', description: 'pnpm test', state: 'working' },
          { id: 'a1', kind: 'agent', description: 'Review the diff', state: 'working' },
          { id: 'a2', kind: 'agent', description: 'Audit the notes', state: 'working' }
        ])
      )
    ).toBe(1)
  })

  it('reads a roster of nothing but subagents as nothing running', () => {
    expect(
      render(roster([{ id: 'a1', kind: 'agent', description: 'Review', state: 'working' }]))
    ).toBe(0)
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
