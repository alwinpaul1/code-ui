import { describe, expect, it, vi } from 'vitest'
import { buildAgentNotificationId } from '../../../src/shared/agent-notification-id'
import {
  hostStackHostRoute,
  navigateToHostStackRoute,
  type HostStackNavigationState
} from '../navigation/host-stack-navigation'
import { buildLocalNotificationData, getNotificationNavigationTarget } from './notification-routing'

/**
 * "When a notification is there and I click on it, it doesn't land on the exact
 * session which got the notification" (2026-10-13, Code UI 0.9.132).
 *
 * The tap opened the right WORKSPACE but never named a tab, so the session
 * screen fell back to whichever tab the desktop had active, or the phone last
 * used. With two agents in one workspace, the "Claude finished" banner for one
 * of them opened the other.
 *
 * What the desktop sends, checked against the installed Orca 1.4.224 bundle
 * (`dispatchMobileNotification` in out/main/index.js): `worktreeId`,
 * `notificationId`, `agentState`, `attentionKey`, `structuredOrigin` — no
 * `paneKey` field. The pane is inside the id: the renderer builds terminal-lane
 * ids with `buildAgentNotificationId` (vendored here from the same source), as
 * `agent:<worktreeId>:<paneKey>:<stateStartedAt>`, each part URI-encoded, and a
 * pane key is `<tabId>:<leafId>`.
 */
const WORKTREE = 'b1f0c2d4-repo::/Users/alwinpaul/Desktop/Project/Code UI'
const NOTIFIED_PANE = '7c2e9a10-5d1b-4b8e-9f3a-2b6c8d0e4f11:3a9d5e72-1c4b-4f6a-8e2d-9b7c5a3f1e08'
const OTHER_PANE = 'e4b8c6a2-9f1d-4c3e-b5a7-1d2f3e4a5b6c:8f7e6d5c-4b3a-4291-8a7b-6c5d4e3f2a1b'

function desktopEvent(paneKey: string, stateStartedAt = 1_760_360_000_000) {
  return {
    source: 'agent-task-complete' as const,
    worktreeId: WORKTREE,
    notificationId: buildAgentNotificationId({ worktreeId: WORKTREE, paneKey, stateStartedAt })!
  }
}

function tapTarget(paneKey: string, hostId = 'host-1') {
  return getNotificationNavigationTarget(buildLocalNotificationData(desktopEvent(paneKey), hostId))!
}

function navigationHarness(initialState: HostStackNavigationState | undefined) {
  const stateListeners = new Set<() => void>()
  let state = initialState
  const navigation = {
    addListener: vi.fn((_event: 'state', listener: () => void) => {
      stateListeners.add(listener)
      return () => stateListeners.delete(listener)
    }),
    dispatch: vi.fn(),
    getState: () => state
  }
  return {
    navigation,
    setState(next: HostStackNavigationState | undefined) {
      state = next
      for (const listener of stateListeners) {
        listener()
      }
    }
  }
}

function rootScoped(inner: HostStackNavigationState): HostStackNavigationState {
  return { key: 'internal', index: 0, routes: [{ key: '__root', name: '__root', state: inner }] }
}

function sessionOnScreen(hostId: string, worktreeId: string): HostStackNavigationState {
  return rootScoped({
    index: 1,
    routes: [
      { name: 'index' },
      {
        name: 'h',
        state: {
          key: 'host-stack',
          index: 0,
          routes: [
            {
              key: 'open-session',
              name: '[hostId]/session/[worktreeId]',
              params: { hostId, worktreeId }
            }
          ]
        }
      }
    ]
  })
}

function hostIndexMounted(hostId: string): HostStackNavigationState {
  return rootScoped({
    index: 1,
    routes: [
      { name: 'index' },
      {
        name: 'h',
        state: {
          key: 'host-stack-2',
          index: 0,
          routes: [{ key: 'host-index', name: '[hostId]/index', params: { hostId } }]
        }
      }
    ]
  })
}

describe('a notification tap opens the tab that raised it', () => {
  it('opens the tab that raised the notification, not the last one used', () => {
    const data = buildLocalNotificationData(desktopEvent(NOTIFIED_PANE), 'host-1')
    expect(data.paneKey).toBe(NOTIFIED_PANE)
    expect(getNotificationNavigationTarget(data)?.sessionTarget?.params).toEqual({
      hostId: 'host-1',
      worktreeId: WORKTREE,
      paneKey: NOTIFIED_PANE,
      agentSessionId: ''
    })
  })

  // Review finding 3: SET_PARAMS merges, so a tap that wrote only its own key
  // left an earlier tap's other key on the route, and the screen applied the
  // older tap after the newer one. Each tap writes both, the absent one empty.
  it('replaces an earlier tap still waiting on the screen, whichever kind it was', () => {
    const structured = getNotificationNavigationTarget({
      hostId: 'host-1',
      worktreeId: WORKTREE,
      notificationId: 'agent-attention:scope:session-9:prompt:p1'
    })
    expect(structured?.sessionTarget?.params).toEqual({
      hostId: 'host-1',
      worktreeId: WORKTREE,
      paneKey: '',
      agentSessionId: 'session-9'
    })
    expect(tapTarget(NOTIFIED_PANE).sessionTarget?.params.agentSessionId).toBe('')
  })

  it('names a different tab for each of two agents in one workspace', () => {
    expect(tapTarget(NOTIFIED_PANE).sessionTarget?.params.paneKey).toBe(NOTIFIED_PANE)
    expect(tapTarget(OTHER_PANE).sessionTarget?.params.paneKey).toBe(OTHER_PANE)
  })

  // A banner posted by 0.9.132 is still in the tray after the update: its data
  // has the id and no pane key. The tap must still find the tab.
  it('opens the notified tab from a banner posted before the pane key was stored', () => {
    const legacy = {
      source: 'agent-task-complete',
      hostId: 'host-1',
      worktreeId: WORKTREE,
      notificationId: desktopEvent(NOTIFIED_PANE).notificationId
    }
    expect(getNotificationNavigationTarget(legacy)?.sessionTarget?.params.paneKey).toBe(
      NOTIFIED_PANE
    )
  })

  it('keeps a notification with no pane in its id on the workspace, naming no tab', () => {
    const target = getNotificationNavigationTarget(
      buildLocalNotificationData(
        { source: 'terminal-bell', worktreeId: WORKTREE, notificationId: 'bell:42' },
        'host-1'
      )
    )
    expect(target?.sessionTarget?.params).toEqual({ hostId: 'host-1', worktreeId: WORKTREE })
  })

  it('does not take a pane from an id that names a different workspace', () => {
    const forged = buildAgentNotificationId({
      worktreeId: 'other-repo::/elsewhere',
      paneKey: NOTIFIED_PANE,
      stateStartedAt: 1
    })!
    const target = getNotificationNavigationTarget({
      hostId: 'host-1',
      worktreeId: WORKTREE,
      notificationId: forged
    })
    expect(target?.sessionTarget?.params.paneKey).toBeUndefined()
  })

  it('opens the tab that raised the notification from a cold start', () => {
    const target = tapTarget(NOTIFIED_PANE)
    const harness = navigationHarness(undefined)
    const push = vi.fn()
    navigateToHostStackRoute(harness.navigation, { push, replace: vi.fn() }, 'host-1', target.sessionTarget!)
    expect(push).toHaveBeenCalledWith(hostStackHostRoute('host-1'))
    harness.setState(hostIndexMounted('host-1'))
    expect(harness.navigation.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'REPLACE',
        payload: expect.objectContaining({
          params: expect.objectContaining({ paneKey: NOTIFIED_PANE })
        })
      })
    )
  })

  // Backgrounded or in the foreground, the same workspace's session screen is
  // the focused route; the tap re-targets it in place with the pane.
  it.each(['backgrounded', 'in the foreground on another tab'])(
    'opens the tab that raised the notification when the app is %s in the same workspace',
    () => {
      const target = tapTarget(NOTIFIED_PANE)
      const harness = navigationHarness(sessionOnScreen('host-1', WORKTREE))
      const router = { push: vi.fn(), replace: vi.fn() }
      navigateToHostStackRoute(harness.navigation, router, 'host-1', target.sessionTarget!)
      expect(router.push).not.toHaveBeenCalled()
      expect(harness.navigation.dispatch).toHaveBeenCalledExactlyOnceWith({
        type: 'SET_PARAMS',
        target: 'host-stack',
        source: 'open-session',
        payload: { params: expect.objectContaining({ paneKey: NOTIFIED_PANE }) }
      })
    }
  )

  it('opens the tab that raised the notification when the app is on another workspace', () => {
    const target = tapTarget(NOTIFIED_PANE)
    const harness = navigationHarness(sessionOnScreen('host-1', 'b1f0c2d4-repo::/elsewhere'))
    const router = { push: vi.fn(), replace: vi.fn() }
    navigateToHostStackRoute(harness.navigation, router, 'host-1', target.sessionTarget!)
    expect(router.push).toHaveBeenCalledWith(hostStackHostRoute('host-1'))
    harness.setState(hostIndexMounted('host-1'))
    expect(harness.navigation.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'REPLACE',
        payload: expect.objectContaining({
          params: { hostId: 'host-1', worktreeId: WORKTREE, paneKey: NOTIFIED_PANE, agentSessionId: '' }
        })
      })
    )
  })

  it('opens the tab that raised the notification when the app is on another host', () => {
    const target = tapTarget(NOTIFIED_PANE, 'host-2')
    const harness = navigationHarness(sessionOnScreen('host-1', WORKTREE))
    const router = { push: vi.fn(), replace: vi.fn() }
    navigateToHostStackRoute(harness.navigation, router, 'host-2', target.sessionTarget!)
    expect(router.push).toHaveBeenCalledWith(hostStackHostRoute('host-2'))
    harness.setState(hostIndexMounted('host-2'))
    expect(harness.navigation.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'REPLACE',
        payload: expect.objectContaining({
          params: { hostId: 'host-2', worktreeId: WORKTREE, paneKey: NOTIFIED_PANE, agentSessionId: '' }
        })
      })
    )
  })
})
