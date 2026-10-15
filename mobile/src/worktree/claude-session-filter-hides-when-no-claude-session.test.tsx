import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import type { RuntimeWorktreeAgentRow } from '../../../src/shared/runtime-types'
import { useClaudeSessionFilter } from './use-claude-session-filter'
import type { Section, Worktree } from './workspace-list-types'

// The filter row is offered only while the list holds a Claude agent, and a filter picked then
// never keeps hiding the list once no Claude agent is left (the user could not see what hides it).
const NOW = Date.parse('2026-10-15T12:00:00Z')
const agent = (paneKey: string, agentType: 'claude' | 'codex', state: RuntimeWorktreeAgentRow['state']): RuntimeWorktreeAgentRow => ({
  paneKey,
  parentPaneKey: null,
  state,
  agentType,
  prompt: '',
  taskTitle: null,
  displayName: null,
  lastAssistantMessage: null,
  toolName: null,
  toolInput: null,
  interrupted: false,
  stateStartedAt: NOW - 1000,
  updatedAt: NOW - 1000
})
const worktree = (id: string, agents: RuntimeWorktreeAgentRow[]): Worktree => ({ worktreeId: id, repo: 'r', branch: 'main', displayName: id, agents }) as unknown as Worktree

let renderer: ReactTestRenderer | null = null
let filter: ReturnType<typeof useClaudeSessionFilter> | null = null
function Probe(props: { worktrees: Worktree[] }) {
  filter = useClaudeSessionFilter(props.worktrees, [{ key: 'all', title: 'All', data: props.worktrees }] as Section[], NOW)
  return null
}
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  filter = null
})

describe('the workspace list’s session filter', () => {
  it('is not offered, and changes nothing, on a list with only Codex agents', () => {
    const codex = [worktree('w1', [agent('t1:a', 'codex', 'working')])]
    act(() => {
      renderer = create(createElement(Probe, { worktrees: codex }))
    })
    expect(filter?.offered).toBe(false)
    expect(filter?.sections[0]?.data).toEqual(codex)
  })

  it('says no session matches when the filter leaves nothing', () => {
    act(() => {
      renderer = create(createElement(Probe, { worktrees: [worktree('w1', [agent('t1:a', 'claude', 'done')])] }))
    })
    act(() => filter!.setValue('working'))
    expect(filter?.sections).toEqual([])
    expect(filter?.emptyNotice).toBe('No sessions match this filter')
  })

  it('reads as All again once the last Claude agent leaves the list', () => {
    act(() => {
      renderer = create(createElement(Probe, { worktrees: [worktree('w1', [agent('t1:a', 'claude', 'done')])] }))
    })
    act(() => filter!.setValue('working'))
    const codexOnly = [worktree('w2', [agent('t2:a', 'codex', 'done')])]
    act(() => renderer!.update(createElement(Probe, { worktrees: codexOnly })))
    expect(filter?.value).toBe('all')
    expect(filter?.sections[0]?.data).toEqual(codexOnly)
    expect(filter?.emptyNotice).toBeNull()
  })

  it('says nothing on an empty list', () => {
    act(() => {
      renderer = create(createElement(Probe, { worktrees: [] }))
    })
    expect(filter?.sections).toEqual([{ key: 'all', title: 'All', data: [] }])
    expect(filter?.emptyNotice).toBeNull()
  })
})
