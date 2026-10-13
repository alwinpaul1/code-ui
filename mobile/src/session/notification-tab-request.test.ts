import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MobileSessionTab } from './mobile-session-route-types'
import {
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
}

function harness(initial: HarnessProps) {
  const switchSessionTab = vi.fn<(tab: MobileSessionTab) => void>()
  const onTabGone = vi.fn<() => void>()
  const clearRequest = vi.fn<() => void>()
  function Screen(props: HarnessProps) {
    useNotificationTabRequest({ ...props, switchSessionTab, onTabGone, clearRequest })
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
      sessionTabs: [LAST_USED],
      tabsLoaded: true
    })
    expect(mounted.switchSessionTab).not.toHaveBeenCalled()
    expect(mounted.onTabGone).toHaveBeenCalledOnce()
    expect(mounted.clearRequest).toHaveBeenCalledOnce()
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

  it('falls back to the tab when its leaf is not on the strip', () => {
    const tab = terminalTab('tab-b', 'leaf-other')
    expect(resolveNotificationTab([LAST_USED, tab], { paneKey: NOTIFIED_PANE }, true)).toEqual({
      kind: 'open',
      tab
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
