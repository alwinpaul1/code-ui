import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MobileSessionTab, SessionTabsResult } from './mobile-session-route-types'
import { useMobileSessionTabApplication } from './use-mobile-session-tab-application'
import type { MobileSessionTerminalListModel } from './use-mobile-session-terminal-list'

vi.mock('./mobile-session-tabs-cache', () => ({
  sessionTabsCacheKey: () => 'key',
  writeCachedSessionTabs: vi.fn()
}))
vi.mock('../notifications/worktree-launch-agents', () => ({ setWorktreeLaunchAgents: vi.fn() }))

// The phone never mints a terminal handle: the active one is whatever `terminal` the
// host's session-tab snapshot names for the active tab (use-mobile-session-tab-
// application.ts), and `terminal.list` may only add a split leaf the snapshot omitted
// (mobile-session-tab-terminal-reconcile.ts). A relay reconnect re-delivers a host
// snapshot through this same path, so it cannot change the handle a send was tapped on.
// The relay-reconnect suites hardcode `'term'`; this drives the real application.
// Handles are Orca's `term_<uuid>` (orca-runtime.ts issueHandle).

const WORKTREE = 'wt'
const TAB_ID = 'tab-1'

function terminalTab(
  handle: string | null,
  extra: Partial<MobileSessionTab> = {}
): MobileSessionTab {
  return {
    type: 'terminal',
    id: TAB_ID,
    title: 'claude',
    terminal: handle,
    launchAgent: 'claude',
    isActive: true,
    ...extra
  } as MobileSessionTab
}

function snapshot(
  version: number,
  tabs: MobileSessionTab[],
  extra: Partial<SessionTabsResult> = {}
): SessionTabsResult {
  return {
    worktree: WORKTREE,
    publicationEpoch: 'epoch-1',
    snapshotVersion: version,
    tabs,
    activeTabId: tabs[0]?.id ?? null,
    activeTabType: tabs[0]?.type ?? null,
    ...extra
  }
}

describe("applying the host's session tabs again after the phone reconnects", () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function mountApplication() {
    const activeHandleRef = { current: null as string | null }
    const unsubscribeTerminal = vi.fn()
    const terminalsRef = { current: [] as never[] }
    const scope = {
      setTerminals: vi.fn(),
      terminalsRef,
      setSessionTabs: vi.fn(),
      sessionTabsRef: { current: [] as MobileSessionTab[] },
      appliedSnapshotMarkerRef: { current: { epoch: null as string | null, version: -1 } },
      appliedSessionTabsRevisionRef: { current: 0 },
      closedTabTombstonesRef: { current: new Map<string, number>() },
      reconcileBufferedDraftsRef: { current: vi.fn() },
      setTerminalsLoaded: vi.fn(),
      defaultTerminalHandlesToLiveInput: vi.fn(),
      setActiveHandle: vi.fn(),
      setActiveSessionTabId: vi.fn(),
      activeSessionTabIdRef: { current: null as string | null },
      selectedSessionTabIdRef: { current: null as string | null },
      markdownDocsRef: { current: new Map() },
      initializedHandlesRef: { current: new Set<string>() },
      terminalDiagnosticsRef: { current: { tabsApplied: vi.fn() } },
      hostId: 'host',
      worktreeId: WORKTREE,
      activeHandleRef,
      activeSessionTabTypeRef: { current: null as string | null },
      visitedSessionTabIdsRef: { current: [] as string[] },
      pendingActiveSessionTabIdRef: { current: null as string | null },
      pendingActiveTerminalHandleRef: { current: null as string | null },
      pendingBrowserFocusPageIdRef: { current: null as string | null },
      initialSessionAutoCreateRef: { current: { sawSessionTabs: false } },
      unsubscribeTerminal,
      subscribeToTerminal: vi.fn(),
      lastKnownTerminalCountRef: { current: 0 }
    }
    let apply: (result: SessionTabsResult) => unknown = () => null
    function Probe(): null {
      apply = useMobileSessionTabApplication(
        scope as unknown as MobileSessionTerminalListModel
      ).applySessionTabs
      return null
    }
    act(() => {
      renderer = create(createElement(Probe))
    })
    return {
      scope,
      activeHandleRef,
      unsubscribeTerminal,
      apply: (result: SessionTabsResult) => apply(result)
    }
  }

  it("keeps the active tab's terminal handle when the same snapshot arrives again after a reconnect", () => {
    const app = mountApplication()
    app.apply(snapshot(1, [terminalTab('term_a')]))
    expect(app.activeHandleRef.current).toBe('term_a')
    // The link drops and comes back: the stream resubscribes and the host sends its
    // snapshot again, a newer version of the same tabs.
    app.apply(snapshot(2, [terminalTab('term_a')]))
    expect(app.activeHandleRef.current).toBe('term_a')
    expect(app.unsubscribeTerminal).not.toHaveBeenCalled()
  })

  it('keeps it while terminal.list is empty, as it is while the desktop graph reloads', () => {
    const app = mountApplication()
    app.apply(snapshot(1, [terminalTab('term_a')]))
    app.scope.terminalsRef.current = []
    app.apply(snapshot(2, [terminalTab('term_a')]))
    expect(app.activeHandleRef.current).toBe('term_a')
    expect(app.unsubscribeTerminal).not.toHaveBeenCalled()
  })

  it('keeps it across a new publisher epoch (a reloaded desktop renderer) that names the same handle', () => {
    const app = mountApplication()
    app.apply(snapshot(5, [terminalTab('term_a')]))
    app.apply(snapshot(1, [terminalTab('term_a')], { publicationEpoch: 'epoch-2' }))
    expect(app.activeHandleRef.current).toBe('term_a')
    expect(app.unsubscribeTerminal).not.toHaveBeenCalled()
  })

  it('does not take a stale snapshot, so an out-of-order reply cannot put the old handle back', () => {
    const app = mountApplication()
    app.apply(snapshot(2, [terminalTab('term_b')]))
    app.apply(snapshot(1, [terminalTab('term_a')]))
    expect(app.activeHandleRef.current).toBe('term_b')
  })

  // The only way the handle changes is the host naming another one: then the tab has a
  // new terminal, and the old subscription is let go.
  it('changes it only when the host names another handle for the tab', () => {
    const app = mountApplication()
    app.apply(snapshot(1, [terminalTab('term_a')]))
    app.apply(snapshot(2, [terminalTab('term_b')]))
    expect(app.activeHandleRef.current).toBe('term_b')
    expect(app.unsubscribeTerminal).toHaveBeenCalledExactlyOnceWith('term_a')
  })

  // Degenerate: a snapshot with no tabs, and a tab whose handle the host has not yet named.
  it('leaves a tab with no handle yet with no active handle, and does not invent one', () => {
    const app = mountApplication()
    app.apply(snapshot(1, [terminalTab(null, { status: 'pending-handle' } as never)]))
    expect(app.activeHandleRef.current).toBeNull()
    app.apply(snapshot(2, []))
    expect(app.activeHandleRef.current).toBeNull()
  })
})
