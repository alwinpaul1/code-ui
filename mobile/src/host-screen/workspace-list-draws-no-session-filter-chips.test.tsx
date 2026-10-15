import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  RefreshControl: 'RefreshControl',
  ScrollView: 'ScrollView',
  SectionList: 'SectionList',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View'
}))
vi.mock('lucide-react-native', () => ({
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  Pin: 'Pin',
  X: 'X'
}))
vi.mock('../components/AuthFailedBanner', () => ({ AuthFailedBanner: 'AuthFailedBanner' }))
vi.mock('../components/HostDiagnosticsLink', () => ({ HostDiagnosticsLink: 'HostDiagnosticsLink' }))
vi.mock('../components/MobileRepoIcon', () => ({ MobileRepoIcon: 'MobileRepoIcon' }))
vi.mock('../components/MobileSearchField', () => ({ MobileSearchField: 'MobileSearchField' }))
vi.mock('../components/NewWorkspaceFab', () => ({
  NewWorkspaceFab: 'NewWorkspaceFab',
  FAB_SIZE: 56
}))
vi.mock('../components/WorktreeListRow', () => ({ WorktreeListRow: 'WorktreeListRow' }))
vi.mock('../worktree/host-workspace-list-states', () => ({
  HostWorkspaceListStates: 'HostWorkspaceListStates'
}))

import { HostWorkspaceList } from './host-workspace-list'

// 2026-10-15, the user's screenshot of the workspace list on a host running Claude: "Remove those
// chips and that empty space". The session filter row (All / Working / Needs input / Ready for
// review) sat under the toolbar, and its horizontal ScrollView, with no flexGrow of its own, took a
// share of the column's height, leaving a band of empty space above the first section.
const NOW = Date.parse('2026-10-15T19:00:00Z')
const claudeWorkspace = {
  worktreeId: 'w1',
  repo: 'code-ui',
  branch: 'main',
  displayName: 'main',
  agents: [{ paneKey: 't1:a', parentPaneKey: null, state: 'working', agentType: 'claude', prompt: '', taskTitle: null, displayName: null, lastAssistantMessage: null, toolName: null, toolInput: null, interrupted: false, stateStartedAt: NOW - 1000, updatedAt: NOW - 1000 }]
}

function listWithClaude() {
  const sections = [{ key: 'code-ui', title: 'code-ui', data: [claudeWorkspace] }]
  const controller = {
    actions: { openWorktreeSession: () => {}, openNewWorktreeModal: () => {} },
    catalog: { refreshing: false, onRefresh: () => {} },
    connState: 'connected',
    contentMaxWidth: 600,
    displayWorktrees: [claudeWorkspace],
    embedded: true,
    forceReconnectHost: () => {},
    hostId: 'host-1',
    insets: { bottom: 0 },
    isReadOnly: false,
    isWideLayout: false,
    noticeParam: undefined,
    now: NOW,
    reconnectAttempts: 0,
    relayRecovery: { pairingRejected: false },
    routeNotice: '',
    router: { push: () => {} },
    sectionsResult: { rawSections: sections, sections, uniqueRepoColors: new Map() },
    setDismissedNotice: () => {},
    settings: { activeFilterCount: 0 },
    state: {
      actionError: '',
      setActionError: () => {},
      catalogError: null,
      collapsedGroups: new Set(),
      groupMode: 'repo',
      repoIconsByName: new Map(),
      search: '',
      showSearch: false,
      worktreesLoaded: true
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the list's children are mocked to host strings, so it reads exactly the controller fields above.
  return { controller } as unknown as Parameters<typeof HostWorkspaceList>[0]
}

describe('the workspace list on a host running Claude', () => {
  it('draws no session filter chips and no band of space above the first section', () => {
    let tree: ReactTestRenderer | null = null
    act(() => {
      tree = create(createElement(HostWorkspaceList, listWithClaude()))
    })
    const root = (tree as unknown as ReactTestRenderer).root
    expect(root.findAll((node) => String(node.type) === 'ScrollView')).toEqual([])
    const words = root.findAll((node) => String(node.type) === 'Text').map((node) => node.props.children)
    expect(words).not.toContain('Working')
    expect(words).not.toContain('Needs input')
    expect(root.findAll((node) => String(node.type) === 'SectionList')).toHaveLength(1)
  })
})
