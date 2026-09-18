import { describe, expect, it } from 'vitest'
import {
  buildLocalNotificationData,
  getNotificationNavigationTarget,
  notificationCredentialRecoveryRoute,
  notificationTapKey
} from './notification-routing'

describe('notification routing', () => {
  it('includes the host id in locally scheduled notification data', () => {
    expect(
      buildLocalNotificationData(
        {
          source: 'agent-task-complete',
          worktreeId: 'repo::/Users/me/orca/workspaces/feature',
          notificationId: 'agent:one'
        },
        'host-1'
      )
    ).toEqual({
      source: 'agent-task-complete',
      hostId: 'host-1',
      worktreeId: 'repo::/Users/me/orca/workspaces/feature',
      notificationId: 'agent:one'
    })
  })

  // Identities stay raw: the target is dispatched as navigator params, not a URL.
  it('routes notification taps to the worktree terminal screen', () => {
    expect(
      getNotificationNavigationTarget({
        hostId: 'host-1',
        worktreeId: 'repo::/Users/me/orca/workspaces/feature'
      })
    ).toEqual({
      hostId: 'host-1',
      sessionTarget: {
        name: '[hostId]/session/[worktreeId]',
        params: { hostId: 'host-1', worktreeId: 'repo::/Users/me/orca/workspaces/feature' }
      }
    })
  })

  it('falls back to the host screen when the payload has no worktree id', () => {
    expect(getNotificationNavigationTarget({ hostId: 'host-1' })).toEqual({
      hostId: 'host-1',
      sessionTarget: null
    })
  })

  it('ignores payloads that cannot identify the paired host', () => {
    expect(getNotificationNavigationTarget({ worktreeId: 'repo::/tmp/worktree' })).toBeNull()
  })

  it('ignores payloads for hosts that are no longer paired', () => {
    expect(
      getNotificationNavigationTarget(
        { hostId: 'removed-host', worktreeId: 'repo::/tmp/worktree' },
        { knownHostIds: new Set(['host-1']) }
      )
    ).toBeNull()
  })

  it.each([
    ['missing', 're-pair'],
    ['temporarily-unavailable', 'retry']
  ] as const)('routes %s host credentials to %s recovery', (status, recovery) => {
    const target = getNotificationNavigationTarget(
      { hostId: 'host-1', worktreeId: 'repo::/tmp/worktree' },
      {
        knownHostIds: new Set(['host-1']),
        credentialStatusByHostId: new Map([['host-1', status]])
      }
    )

    expect(target).toMatchObject({ hostId: 'host-1', credentialRecovery: recovery })
    expect(notificationCredentialRecoveryRoute(target!)).toBe(
      status === 'missing' ? '/pair-scan' : '/'
    )
  })

  it('keeps ready hosts on the requested notification destination', () => {
    const target = getNotificationNavigationTarget(
      { hostId: 'host-1', worktreeId: 'repo::/tmp/worktree' },
      { credentialStatusByHostId: new Map([['host-1', 'ready']]) }
    )

    expect(target?.sessionTarget).not.toBeNull()
    expect(notificationCredentialRecoveryRoute(target!)).toBeNull()
  })
})

/**
 * Every banner for a session is posted under one identifier
 * (`codeui:<host>:<worktree>`, since 2026-09-15), and the tap dedup was keyed
 * on that identifier for the app's life. So the first body tap on a session's
 * banner navigated, and every later tap on that session's banner — a new
 * question, a new completion — was swallowed as "already handled" (review
 * finding F3, 2026-09-18). The dedup exists for one thing only: the same
 * response delivered twice at cold start, by getLastNotificationResponse and
 * the listener. A key that changes per POSTING keeps that and nothing else.
 */
describe('telling one tap from the next on the same session banner', () => {
  function response(overrides: { notificationId?: string; date?: number } = {}) {
    return {
      actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
      notification: {
        date: overrides.date ?? 1_700_000_000_000,
        request: {
          identifier: 'codeui:host-1:wt-1',
          content: {
            data: {
              hostId: 'host-1',
              worktreeId: 'wt-1',
              ...(overrides.notificationId ? { notificationId: overrides.notificationId } : {})
            }
          }
        }
      }
    }
  }

  it('gives the same delivery the same key', () => {
    expect(notificationTapKey(response({ notificationId: 'agent:1' }))).toBe(
      notificationTapKey(response({ notificationId: 'agent:1' }))
    )
  })

  it('gives a later posting on the same banner a different key', () => {
    expect(notificationTapKey(response({ notificationId: 'agent:1' }))).not.toBe(
      notificationTapKey(response({ notificationId: 'agent:2' }))
    )
  })

  // A banner without the desktop's id (a plain event) still changes per posting.
  it('falls back to the posting time when there is no notification id', () => {
    expect(notificationTapKey(response({ date: 1 }))).not.toBe(
      notificationTapKey(response({ date: 2 }))
    )
    expect(notificationTapKey(response({ date: 1 }))).toBe(notificationTapKey(response({ date: 1 })))
  })

  it('keeps two sessions apart even when posted at the same instant', () => {
    const other = response({ date: 1 })
    other.notification.request.identifier = 'codeui:host-1:wt-2'
    expect(notificationTapKey(response({ date: 1 }))).not.toBe(notificationTapKey(other))
  })
})
