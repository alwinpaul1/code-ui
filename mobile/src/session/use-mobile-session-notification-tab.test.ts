import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MobileSessionTab } from './mobile-session-route-types'
import type { MobileSessionTabSwitchingModel } from './use-mobile-session-tab-switching'

const route = vi.hoisted(() => ({ params: {} as Record<string, string | string[]> }))
vi.mock('expo-router', () => ({ useLocalSearchParams: () => route.params }))

import {
  NOTIFICATION_TAB_GONE_MESSAGE,
  useMobileSessionNotificationTab
} from './use-mobile-session-notification-tab'

/**
 * The native session screen reading the tab a notification tap put in its
 * route. Before 2026-10-13 nothing on the native screen read `paneKey` at all
 * (only the web shell's route switch forwarded it), so even a route that named
 * the tab landed on the workspace's active one.
 */
function tab(id: string, leafId: string, isActive = false): MobileSessionTab {
  return {
    type: 'terminal',
    id: `${id}::${leafId}`,
    title: 'claude',
    parentTabId: id,
    leafId,
    terminal: `term-${leafId}`,
    isActive
  }
}

const ACTIVE = tab('tab-a', 'leaf-a', true)
const NOTIFIED = tab('tab-b', 'leaf-b')

function scopeWith(sessionTabs: MobileSessionTab[]) {
  return {
    router: { setParams: vi.fn() },
    showToast: vi.fn(),
    worktreeId: 'wt',
    sessionTabs,
    terminalsLoaded: true,
    switchSessionTab: vi.fn()
  }
}

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  route.params = {}
})

function render(scope: ReturnType<typeof scopeWith>) {
  function Screen() {
    useMobileSessionNotificationTab(scope as unknown as MobileSessionTabSwitchingModel)
    return null
  }
  act(() => {
    renderer = create(createElement(Screen))
  })
}

describe('the native session screen and a notification tap', () => {
  it('opens the tab that raised the notification, not the last one used', () => {
    route.params = { hostId: 'h', worktreeId: 'wt', paneKey: 'tab-b:leaf-b' }
    const scope = scopeWith([ACTIVE, NOTIFIED])
    render(scope)
    expect(scope.switchSessionTab).toHaveBeenCalledExactlyOnceWith(NOTIFIED)
    expect(scope.router.setParams).toHaveBeenCalledExactlyOnceWith({ paneKey: '' })
    expect(scope.showToast).not.toHaveBeenCalled()
  })

  it('says the tab is gone when it closed since the notification', () => {
    route.params = { hostId: 'h', worktreeId: 'wt', paneKey: 'tab-gone:leaf-gone' }
    const scope = scopeWith([ACTIVE])
    render(scope)
    expect(scope.switchSessionTab).not.toHaveBeenCalled()
    expect(scope.showToast).toHaveBeenCalledWith(NOTIFICATION_TAB_GONE_MESSAGE, expect.any(Number))
    expect(scope.router.setParams).toHaveBeenCalledExactlyOnceWith({ paneKey: '' })
  })

  it('leaves the tab alone when the route names none', () => {
    route.params = { hostId: 'h', worktreeId: 'wt', paneKey: '' }
    const scope = scopeWith([ACTIVE, NOTIFIED])
    render(scope)
    expect(scope.switchSessionTab).not.toHaveBeenCalled()
    expect(scope.router.setParams).not.toHaveBeenCalled()
  })

  it('opens an agent session tab named by its session id', () => {
    const agentSession: MobileSessionTab = {
      type: 'agent-session',
      id: 'as',
      title: 'Claude',
      sessionId: 's-1',
      agent: 'claude',
      isActive: false
    }
    route.params = { hostId: 'h', worktreeId: 'wt', agentSessionId: 's-1' }
    const scope = scopeWith([ACTIVE, agentSession])
    render(scope)
    expect(scope.switchSessionTab).toHaveBeenCalledExactlyOnceWith(agentSession)
    expect(scope.router.setParams).toHaveBeenCalledExactlyOnceWith({ agentSessionId: '' })
  })
})
