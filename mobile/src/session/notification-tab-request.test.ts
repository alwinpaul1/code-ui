import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MobileSessionTab } from './mobile-session-route-types'
import {
  NOTIFICATION_TAB_GONE_AFTER_MS,
  resolveNotificationTab,
  useNotificationTabRequest,
  type NotificationTabRequest
} from './notification-tab-request'

/**
 * The session screen's half of "a notification tap lands on the exact session
 * that raised it" (2026-10-13). The route carries the pane the desktop named in
 * the notification; the screen has to select that tab once it knows the
 * workspace's tabs, whatever tab the desktop or the phone had active, and say
 * so when the tab has closed since.
 *
 * Tab shapes as the phone holds them: a host terminal tab is addressed
 * `parentTabId::leafId` (mobile-session-tab-terminal-reconcile.ts), while the
 * desktop's pane key is `tabId:leafId` (Orca 1.4.224's own parser: exactly one
 * colon).
 */
type TerminalTab = Extract<MobileSessionTab, { type: 'terminal' }>

function terminalTab(tabId: string, leafId: string, isActive = false): TerminalTab {
  return {
    type: 'terminal',
    id: `${tabId}::${leafId}`,
    title: 'claude',
    parentTabId: tabId,
    leafId,
    terminal: `term-${leafId}`,
    isActive
  }
}

const LAST_USED = terminalTab('tab-a', 'leaf-a', true)
const NOTIFIED = terminalTab('tab-b', 'leaf-b')
const NOTIFIED_PANE = 'tab-b:leaf-b'

type HarnessProps = {
  worktreeId: string
  request: NotificationTabRequest | null
  sessionTabs: readonly MobileSessionTab[]
  tabsLoaded: boolean
  /** The host link is up; true unless a test says otherwise. */
  connected?: boolean
}

function harness(initial: HarnessProps) {
  const switchSessionTab = vi.fn<(tab: MobileSessionTab) => void>()
  const onTabGone = vi.fn<() => void>()
  const clearRequest = vi.fn<() => void>()
  function Screen(props: HarnessProps) {
    useNotificationTabRequest({
      ...props,
      connected: props.connected ?? true,
      switchSessionTab,
      onTabGone,
      clearRequest
    })
    return null
  }
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(createElement(Screen, initial))
  })
  return {
    switchSessionTab,
    onTabGone,
    clearRequest,
    update(next: HarnessProps) {
      act(() => renderer?.update(createElement(Screen, next)))
    },
    unmount() {
      act(() => renderer?.unmount())
    }
  }
}

let mounted: ReturnType<typeof harness> | null = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
})

describe('the session screen selects the tab a notification named', () => {
  it('opens the tab that raised the notification, not the last one used', () => {
    mounted = harness({
      worktreeId: 'wt',
      request: { paneKey: NOTIFIED_PANE },
      sessionTabs: [LAST_USED, NOTIFIED],
      tabsLoaded: true
    })
    expect(mounted.switchSessionTab).toHaveBeenCalledExactlyOnceWith(NOTIFIED)
    expect(mounted.clearRequest).toHaveBeenCalledOnce()
    expect(mounted.onTabGone).not.toHaveBeenCalled()
  })

  // Killed app: the screen mounts with the pane in its route before the relay
  // is up and before the workspace's tabs are known.
  it('opens the tab that raised the notification from a cold start, once the tabs load', () => {
    mounted = harness({
      worktreeId: 'wt',
      request: { paneKey: NOTIFIED_PANE },
      sessionTabs: [],
      tabsLoaded: false
    })
    expect(mounted.switchSessionTab).not.toHaveBeenCalled()
    expect(mounted.onTabGone).not.toHaveBeenCalled()
    expect(mounted.clearRequest).not.toHaveBeenCalled()
    mounted.update({
      worktreeId: 'wt',
      request: { paneKey: NOTIFIED_PANE },
      sessionTabs: [LAST_USED, NOTIFIED],
      tabsLoaded: true
    })
    expect(mounted.switchSessionTab).toHaveBeenCalledExactlyOnceWith(NOTIFIED)
    expect(mounted.clearRequest).toHaveBeenCalledOnce()
  })

  // Backgrounded or open on another tab of the same workspace: the screen is
  // mounted, its tabs are loaded, and the tap re-targets its route.
  it.each(['backgrounded', 'in the foreground on another tab'])(
    'opens the tab that raised the notification when the app is %s',
    () => {
      mounted = harness({
        worktreeId: 'wt',
        request: null,
        sessionTabs: [LAST_USED, NOTIFIED],
        tabsLoaded: true
      })
      mounted.update({
        worktreeId: 'wt',
        request: { paneKey: NOTIFIED_PANE },
        sessionTabs: [LAST_USED, NOTIFIED],
        tabsLoaded: true
      })
      expect(mounted.switchSessionTab).toHaveBeenCalledExactlyOnceWith(NOTIFIED)
    }
  )

  // The route screen is reused across workspaces; the tabs of the one being
  // left must not decide anything for the one being opened.
  it('opens the tab that raised the notification when the app was on another workspace', () => {
    const otherWorkspaceTab = terminalTab('tab-z', 'leaf-z', true)
    mounted = harness({
      worktreeId: 'wt-other',
      request: null,
      sessionTabs: [otherWorkspaceTab],
      tabsLoaded: true
    })
    mounted.update({
      worktreeId: 'wt',
      request: { paneKey: NOTIFIED_PANE },
      sessionTabs: [otherWorkspaceTab],
      tabsLoaded: false
    })
    expect(mounted.onTabGone).not.toHaveBeenCalled()
    expect(mounted.switchSessionTab).not.toHaveBeenCalled()
    mounted.update({
      worktreeId: 'wt',
      request: { paneKey: NOTIFIED_PANE },
      sessionTabs: [LAST_USED, NOTIFIED],
      tabsLoaded: true
    })
    expect(mounted.switchSessionTab).toHaveBeenCalledExactlyOnceWith(NOTIFIED)
  })

  it('opens the workspace and says the tab is gone when it closed since the notification', () => {
    mounted = harness({
      worktreeId: 'wt',
      request: { paneKey: NOTIFIED_PANE },
      sessionTabs: [],
      tabsLoaded: false
    })
    mounted.update({
      worktreeId: 'wt',
      request: { paneKey: NOTIFIED_PANE },
      sessionTabs: [LAST_USED],
      tabsLoaded: true
    })
    expect(mounted.switchSessionTab).not.toHaveBeenCalled()
    expect(mounted.onTabGone).toHaveBeenCalledOnce()
    expect(mounted.clearRequest).toHaveBeenCalledOnce()
  })

  // Review finding 1 (2026-10-13): back from the background, the tabs on screen
  // are the ones from before it, still marked loaded while the relay redials.
  // A tab that opened meanwhile is not in them; the tap must wait for the
  // reconnect snapshot instead of calling it closed.
  it('does not call a tab gone from the tabs held over from before the app was backgrounded', () => {
    mounted = harness({
      worktreeId: 'wt',
      request: null,
      sessionTabs: [LAST_USED],
      tabsLoaded: true,
      connected: false
    })
    mounted.update({
      worktreeId: 'wt',
      request: { paneKey: NOTIFIED_PANE },
      sessionTabs: [LAST_USED],
      tabsLoaded: true,
      connected: false
    })
    expect(mounted.onTabGone).not.toHaveBeenCalled()
    mounted.update({
      worktreeId: 'wt',
      request: { paneKey: NOTIFIED_PANE },
      sessionTabs: [LAST_USED, NOTIFIED],
      tabsLoaded: true,
      connected: true
    })
    expect(mounted.onTabGone).not.toHaveBeenCalled()
    expect(mounted.switchSessionTab).toHaveBeenCalledExactlyOnceWith(NOTIFIED)
  })

  // Review finding 2: an empty snapshot is transient on this host (the tab
  // application keeps surfaces through one), so it is no proof of a close.
  it('does not call a tab gone from an empty first snapshot', () => {
    mounted = harness({
      worktreeId: 'wt',
      request: { paneKey: NOTIFIED_PANE },
      sessionTabs: [],
      tabsLoaded: false
    })
    mounted.update({ worktreeId: 'wt', request: { paneKey: NOTIFIED_PANE }, sessionTabs: [], tabsLoaded: true })
    expect(mounted.onTabGone).not.toHaveBeenCalled()
    mounted.update({
      worktreeId: 'wt',
      request: { paneKey: NOTIFIED_PANE },
      sessionTabs: [LAST_USED, NOTIFIED],
      tabsLoaded: true
    })
    expect(mounted.switchSessionTab).toHaveBeenCalledExactlyOnceWith(NOTIFIED)
    expect(mounted.onTabGone).not.toHaveBeenCalled()
  })

  // No newer snapshot ever comes when nothing changed on the desktop: an
  // identical republication keeps the same list. Connected for a while with
  // the tab still missing is the answer, not a wait for ever.
  it('says the tab is gone once connected long enough with no snapshot naming it', () => {
    vi.useFakeTimers()
    try {
      mounted = harness({
        worktreeId: 'wt',
        request: { paneKey: NOTIFIED_PANE },
        sessionTabs: [LAST_USED],
        tabsLoaded: true
      })
      expect(mounted.onTabGone).not.toHaveBeenCalled()
      act(() => {
        vi.advanceTimersByTime(NOTIFICATION_TAB_GONE_AFTER_MS)
      })
      expect(mounted.onTabGone).toHaveBeenCalledOnce()
      expect(mounted.clearRequest).toHaveBeenCalledOnce()
      expect(mounted.switchSessionTab).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not time a tab out while the host is not connected', () => {
    vi.useFakeTimers()
    try {
      mounted = harness({
        worktreeId: 'wt',
        request: { paneKey: NOTIFIED_PANE },
        sessionTabs: [LAST_USED],
        tabsLoaded: true,
        connected: false
      })
      act(() => {
        vi.advanceTimersByTime(NOTIFICATION_TAB_GONE_AFTER_MS * 3)
      })
      expect(mounted.onTabGone).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  // Cached tabs from the last visit are on screen before the live snapshot;
  // a tab missing from the cache may well be live, so nothing is said yet.
  it('does not call the tab gone before the live tabs have loaded', () => {
    mounted = harness({
      worktreeId: 'wt',
      request: { paneKey: NOTIFIED_PANE },
      sessionTabs: [LAST_USED],
      tabsLoaded: false
    })
    expect(mounted.onTabGone).not.toHaveBeenCalled()
    expect(mounted.clearRequest).not.toHaveBeenCalled()
  })

  it('selects the notified tab of two in one workspace, whichever is first or active', () => {
    const first = terminalTab('tab-1', 'leaf-1')
    const second = terminalTab('tab-2', 'leaf-2', true)
    mounted = harness({
      worktreeId: 'wt',
      request: { paneKey: 'tab-1:leaf-1' },
      sessionTabs: [first, second],
      tabsLoaded: true
    })
    expect(mounted.switchSessionTab).toHaveBeenCalledExactlyOnceWith(first)
    mounted.update({
      worktreeId: 'wt',
      request: null,
      sessionTabs: [first, second],
      tabsLoaded: true
    })
    mounted.update({
      worktreeId: 'wt',
      request: { paneKey: 'tab-2:leaf-2' },
      sessionTabs: [first, second],
      tabsLoaded: true
    })
    expect(mounted.switchSessionTab).toHaveBeenLastCalledWith(second)
  })

  it('handles a second tap on the same tab after the first was spent', () => {
    mounted = harness({
      worktreeId: 'wt',
      request: { paneKey: NOTIFIED_PANE },
      sessionTabs: [LAST_USED, NOTIFIED],
      tabsLoaded: true
    })
    mounted.update({ worktreeId: 'wt', request: null, sessionTabs: [LAST_USED, NOTIFIED], tabsLoaded: true })
    mounted.update({
      worktreeId: 'wt',
      request: { paneKey: NOTIFIED_PANE },
      sessionTabs: [LAST_USED, NOTIFIED],
      tabsLoaded: true
    })
    expect(mounted.switchSessionTab).toHaveBeenCalledTimes(2)
  })

  it('applies one tap once, however many snapshots arrive before its route clears', () => {
    mounted = harness({
      worktreeId: 'wt',
      request: { paneKey: NOTIFIED_PANE },
      sessionTabs: [LAST_USED, NOTIFIED],
      tabsLoaded: true
    })
    mounted.update({
      worktreeId: 'wt',
      request: { paneKey: NOTIFIED_PANE },
      sessionTabs: [{ ...LAST_USED }, { ...NOTIFIED }],
      tabsLoaded: true
    })
    expect(mounted.switchSessionTab).toHaveBeenCalledOnce()
  })
})

describe('which tab a notification names', () => {
  it('finds a split leaf by its pane, not by its tab alone', () => {
    const leafOne = terminalTab('tab-s', 'leaf-1')
    const leafTwo = terminalTab('tab-s', 'leaf-2')
    expect(resolveNotificationTab([leafOne, leafTwo], { paneKey: 'tab-s:leaf-2' }, true)).toEqual({
      kind: 'open',
      tab: leafTwo
    })
  })

  it('finds the tab by the agent status pane key when the tab has no leaf address', () => {
    const legacy: TerminalTab = {
      type: 'terminal',
      id: 'tab-l',
      title: 'claude',
      terminal: 'term-l',
      isActive: false,
      agentStatus: { paneKey: 'tab-l:1' } as TerminalTab['agentStatus']
    }
    expect(resolveNotificationTab([LAST_USED, legacy], { paneKey: 'tab-l:1' }, true)).toEqual({
      kind: 'open',
      tab: legacy
    })
  })

  // Review finding 5: the phone draws a pill per leaf, so a closed leaf of a
  // split is a closed tab; opening its sibling would be a positional pick.
  it('does not open a sibling pane when the notified leaf of a split has closed', () => {
    const sibling = terminalTab('tab-b', 'leaf-other')
    expect(resolveNotificationTab([LAST_USED, sibling], { paneKey: NOTIFIED_PANE }, true)).toEqual({
      kind: 'gone'
    })
  })

  it('finds a tab from a host that publishes no leaf address, by its tab id', () => {
    const legacy: TerminalTab = {
      type: 'terminal',
      id: 'tab-b',
      title: 'claude',
      terminal: 'term-b',
      isActive: false
    }
    expect(resolveNotificationTab([LAST_USED, legacy], { paneKey: NOTIFIED_PANE }, true)).toEqual({
      kind: 'open',
      tab: legacy
    })
  })

  it('finds an agent session tab by its session id', () => {
    const agentSession: MobileSessionTab = {
      type: 'agent-session',
      id: 'as-tab',
      title: 'Claude',
      sessionId: 'session-9',
      agent: 'claude',
      isActive: false
    }
    expect(
      resolveNotificationTab([LAST_USED, agentSession], { agentSessionId: 'session-9' }, true)
    ).toEqual({ kind: 'open', tab: agentSession })
  })

  it('reports gone for an empty workspace, and waits while it is still loading', () => {
    expect(resolveNotificationTab([], { paneKey: NOTIFIED_PANE }, true)).toEqual({ kind: 'gone' })
    expect(resolveNotificationTab([], { paneKey: NOTIFIED_PANE }, false)).toEqual({ kind: 'wait' })
  })

  it('finds the only tab of a one-tab workspace', () => {
    expect(resolveNotificationTab([NOTIFIED], { paneKey: NOTIFIED_PANE }, true)).toEqual({
      kind: 'open',
      tab: NOTIFIED
    })
  })

  // Cached tabs from the last visit: selecting one before the relay is up
  // tells the desktop nothing.
  it('waits for the live tabs even when the cached strip already has the tab', () => {
    expect(resolveNotificationTab([NOTIFIED], { paneKey: NOTIFIED_PANE }, false)).toEqual({
      kind: 'wait'
    })
  })
})
