import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import type { RuntimeWorktreeAgentRow } from '../../../src/shared/runtime-types'
import type { ClaudeSessionFilter } from '../session/claude-session-state'
import type { Section, Worktree } from '../worktree/workspace-list-types'
import { useFilteredWorkspaceList } from './use-filtered-workspace-list'

// Reported 2026-10-15 (review of the session-filter branch): the scroll to the desktop's active
// workspace indexed the UNFILTERED sections while the SectionList it drives drew the filtered
// ones. With a filter on, an active-workspace change scrolled to the wrong row, or threw inside
// RN's VirtualizedSectionList.scrollToLocation when the filter had dropped a section, and it
// scrolled even when the filter hid the active row. The fake list below reads its location the
// way RN does: `sections[sectionIndex].data[itemIndex]` of the sections it draws.
const NOW = Date.parse('2026-10-15T12:00:00Z')

function agent(paneKey: string, state: RuntimeWorktreeAgentRow['state']): RuntimeWorktreeAgentRow {
  return {
    paneKey,
    parentPaneKey: null,
    state,
    agentType: 'claude',
    prompt: '',
    taskTitle: null,
    displayName: null,
    lastAssistantMessage: null,
    toolName: null,
    toolInput: null,
    interrupted: false,
    stateStartedAt: NOW - 1000,
    updatedAt: NOW - 1000
  }
}

type Row = { id: string; state: RuntimeWorktreeAgentRow['state'] }
const worktree = (row: Row, activeId: string | null): Worktree =>
  ({ worktreeId: row.id, repo: 'r', branch: 'main', displayName: row.id, isActive: row.id === activeId, agents: [agent(`${row.id}:leaf`, row.state)] }) as unknown as Worktree

let renderer: ReactTestRenderer | null = null
let view: ReturnType<typeof useFilteredWorkspaceList> | null = null
let landed: (string | undefined)[] = []

function Probe(props: { layout: Record<string, Row[]>; activeId: string | null }) {
  const sections: Section[] = Object.entries(props.layout).map(([key, rows]) => ({ key, title: key, data: rows.map((row) => worktree(row, props.activeId)) }))
  const worktrees = sections.flatMap((section) => section.data)
  view = useFilteredWorkspaceList(worktrees, sections, NOW)
  const drawn = view.sessionFilter.sections
  // The SectionList the hook's ref is attached to draws `sessionFilter.sections`.
  view.activeWorktreeScroll.sectionListRef.current = {
    scrollToLocation: ({ sectionIndex, itemIndex }: { sectionIndex: number; itemIndex: number }) => {
      landed.push(drawn[sectionIndex].data[itemIndex]?.worktreeId)
    }
  } as never
  return null
}

function show(layout: Record<string, Row[]>, activeId: string | null, filter: ClaudeSessionFilter) {
  act(() => {
    renderer = create(createElement(Probe, { layout, activeId: null }))
  })
  act(() => view!.sessionFilter.setValue(filter))
  landed = []
  act(() => renderer!.update(createElement(Probe, { layout, activeId })))
}

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  view = null
  landed = []
})

describe('the workspace list with a session filter on', () => {
  it('scrolls to the active workspace’s own row, not the row at its unfiltered index', () => {
    const layout = { all: [{ id: 'w-busy', state: 'working' }, { id: 'w-target', state: 'done' }, { id: 'w-a', state: 'done' }, { id: 'w-b', state: 'done' }] } satisfies Record<string, Row[]>
    show(layout, 'w-target', 'completed')
    expect(landed).toEqual(['w-target'])
  })

  it('does not throw, and lands on the row, when the filter dropped a section before it', () => {
    const layout = { pinned: [{ id: 'w-busy', state: 'working' }], all: [{ id: 'w-x', state: 'done' }, { id: 'w-target', state: 'done' }] } satisfies Record<string, Row[]>
    show(layout, 'w-target', 'completed')
    expect(landed).toEqual(['w-target'])
  })

  it('does not scroll at all when the filter hides the active workspace', () => {
    const layout = { pinned: [{ id: 'w-busy', state: 'working' }], all: [{ id: 'w-x', state: 'done' }] } satisfies Record<string, Row[]>
    show(layout, 'w-busy', 'completed')
    expect(landed).toEqual([])
  })

  it('lands on the one row the filter leaves', () => {
    const layout = { all: [{ id: 'w-busy', state: 'working' }, { id: 'w-target', state: 'done' }] } satisfies Record<string, Row[]>
    show(layout, 'w-target', 'completed')
    expect(landed).toEqual(['w-target'])
  })

  it('does nothing, and does not throw, when the filter leaves no row', () => {
    const layout = { all: [{ id: 'w-busy', state: 'working' }, { id: 'w-target', state: 'done' }] } satisfies Record<string, Row[]>
    show(layout, 'w-target', 'needs-input')
    expect(view!.sessionFilter.sections).toEqual([])
    expect(landed).toEqual([])
  })

  it('still scrolls to the active workspace under All', () => {
    const layout = { pinned: [{ id: 'w-busy', state: 'working' }], all: [{ id: 'w-x', state: 'done' }, { id: 'w-target', state: 'done' }] } satisfies Record<string, Row[]>
    show(layout, 'w-target', 'all')
    expect(landed).toEqual(['w-target'])
  })
})
