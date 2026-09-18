import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { getNotificationNavigationTarget } from './notification-routing'
import {
  hostStackHostRoute,
  navigateToHostStackRoute,
  type HostStackNavigationState
} from '../navigation/host-stack-navigation'

const rootLayoutSource = readFileSync(new URL('../../app/_layout.tsx', import.meta.url), 'utf8')

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
    setState(nextState: HostStackNavigationState | undefined) {
      state = nextState
      for (const listener of stateListeners) {
        listener()
      }
    }
  }
}

// A notification tap is handled by app/_layout.tsx, which Expo Router mounts as a screen of its
// own internal navigator — hence the extra `__root` level around the app's root stack.
function rootLayoutScopedState(inner: HostStackNavigationState): HostStackNavigationState {
  return { key: 'internal', index: 0, routes: [{ key: '__root', name: '__root', state: inner }] }
}

describe('notification route coordination', () => {
  it('mounts the host before replacing it with the notification session, from a cold navigator', () => {
    const target = getNotificationNavigationTarget({
      hostId: 'host/one',
      worktreeId: 'repo::/Users/me/orca/workspaces/feature'
    })
    // Cold start: the tap is handled before the root navigator has committed any state.
    const harness = navigationHarness(undefined)
    const push = vi.fn()

    navigateToHostStackRoute(
      harness.navigation,
      { push, replace: vi.fn() },
      target!.hostId,
      target!.sessionTarget!
    )

    expect(push).toHaveBeenCalledWith(hostStackHostRoute('host/one'))
    expect(harness.navigation.dispatch).not.toHaveBeenCalled()

    harness.setState(rootLayoutScopedState({ index: 0, routes: [{ name: 'index' }] }))
    harness.setState(
      rootLayoutScopedState({
        index: 1,
        routes: [{ name: 'index' }, { name: 'h', state: undefined }]
      })
    )
    expect(harness.navigation.dispatch).not.toHaveBeenCalled()

    harness.setState(
      rootLayoutScopedState({
        index: 1,
        routes: [
          { name: 'index' },
          {
            name: 'h',
            state: {
              key: '/h',
              index: 0,
              routes: [
                {
                  key: 'host-index',
                  name: '[hostId]/index',
                  params: { hostId: encodeURIComponent('host/one') }
                }
              ]
            }
          }
        ]
      })
    )

    expect(harness.navigation.dispatch).toHaveBeenCalledWith({
      type: 'REPLACE',
      target: '/h',
      source: 'host-index',
      payload: target!.sessionTarget
    })
  })

  it('leaves a host-only notification as a shallow push with nothing to coordinate', () => {
    expect(getNotificationNavigationTarget({ hostId: 'host-1' })?.sessionTarget).toBeNull()
  })

  it('routes notification taps through the coordinated transition, not a bare push', () => {
    const start = rootLayoutSource.indexOf('// ─── Notification tap routing ───')
    const end = rootLayoutSource.indexOf('// ─── End notification tap routing ───', start)

    // Assert the markers first: a renamed banner would otherwise slice garbage and report a
    // missing call instead of the real cause.
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)

    const notificationEffect = rootLayoutSource.slice(start, end)
    expect(notificationEffect).toContain('openNotificationRoute(target)')
    expect(notificationEffect).not.toContain('router.push(')
  })

  /**
   * Every banner for a session shares one request identifier, so a dedup keyed
   * on the identifier alone let exactly one body tap per session through for
   * the app's life: the first opened the session, every later one — a new
   * question, a new completion — was swallowed (review finding F3, 2026-09-18).
   * The dedup has to read the per-posting key, and only on the body-tap path.
   */
  it('dedups body taps per posting, not per session banner', () => {
    const start = rootLayoutSource.indexOf('// ─── Notification tap routing ───')
    const end = rootLayoutSource.indexOf('// ─── End notification tap routing ───', start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)

    const notificationEffect = rootLayoutSource.slice(start, end)
    expect(notificationEffect).toContain('const notificationId = notificationTapKey(response)')
    expect(notificationEffect).not.toContain(
      'const notificationId = response.notification.request.identifier'
    )
  })

  /**
   * "user can reply directly from the notification dont open the app"
   * (2026-09-18). A button's branch ends in the clear and a return — nothing
   * on it navigates — and what the user typed into a reply field reaches the
   * answer path.
   */
  it('answers a button or a reply in the shade and never navigates for it', () => {
    const start = rootLayoutSource.indexOf('// ─── Notification tap routing ───')
    const end = rootLayoutSource.indexOf('// ─── End notification tap routing ───', start)
    const notificationEffect = rootLayoutSource.slice(start, end)
    const answered = notificationEffect.indexOf('await answerPromptFromNotification(')
    expect(answered).toBeGreaterThanOrEqual(0)
    expect(notificationEffect).toContain('const userText = response.userText ?? null')
    expect(notificationEffect).toContain('          userText,')
    // The button branch closes with the clear and a return, before the routing.
    const branchEnd = notificationEffect.indexOf('clearLastNotificationResponse()\n        return\n      }', answered)
    expect(branchEnd).toBeGreaterThan(answered)
    expect(notificationEffect.slice(answered, branchEnd)).not.toContain('openNotificationRoute(')
    expect(notificationEffect).not.toContain('open-app')
  })

  // A typed reply that was not sent must not leave Android's reply spinner up
  // with no word: the banner is re-posted with the verdict, on that branch.
  it('re-posts the banner with the verdict when a typed reply was not sent', () => {
    const start = rootLayoutSource.indexOf('// ─── Notification tap routing ───')
    const end = rootLayoutSource.indexOf('// ─── End notification tap routing ───', start)
    const notificationEffect = rootLayoutSource.slice(start, end)
    const answered = notificationEffect.indexOf('const outcome = await answerPromptFromNotification(')
    expect(answered).toBeGreaterThanOrEqual(0)
    const repost = notificationEffect.indexOf('await repostBannerWithReplyVerdict(response, outcome)', answered)
    expect(repost).toBeGreaterThan(answered)
    expect(notificationEffect.slice(answered, repost)).toContain(
      "if (userText !== null && outcome !== 'sent' && outcome !== 'not-an-answer')"
    )
  })
})

it('reuses the current workspace screen and targets the notification pane without pushing', () => {
  const target = getNotificationNavigationTarget({
    hostId: 'host',
    worktreeId: 'folder::/workspace',
    paneKey: 'agent-tab:leaf'
  })!
  const harness = navigationHarness(
    rootLayoutScopedState({
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
                key: 'existing-workspace',
                name: target.sessionTarget!.name,
                params: { hostId: 'host', worktreeId: 'folder::/workspace' }
              }
            ]
          }
        }
      ]
    })
  )
  const router = { push: vi.fn(), replace: vi.fn() }
  const controller = navigateToHostStackRoute(
    harness.navigation,
    router,
    target.hostId,
    target.sessionTarget!
  )
  expect(router.push).not.toHaveBeenCalled()
  expect(router.replace).not.toHaveBeenCalled()
  expect(harness.navigation.dispatch).toHaveBeenCalledExactlyOnceWith({
    type: 'SET_PARAMS',
    target: 'host-stack',
    source: 'existing-workspace',
    payload: { params: target.sessionTarget!.params }
  })
  expect(controller.isActive()).toBe(false)
})

it('does not reuse a different workspace on the same host', () => {
  const target = getNotificationNavigationTarget({ hostId: 'host', worktreeId: 'workspace-b' })!
  const harness = navigationHarness(
    rootLayoutScopedState({
      index: 0,
      routes: [
        {
          name: 'h',
          state: {
            key: 'host-stack',
            index: 0,
            routes: [
              {
                key: 'workspace-a',
                name: target.sessionTarget!.name,
                params: { hostId: 'host', worktreeId: 'workspace-a' }
              }
            ]
          }
        }
      ]
    })
  )
  const router = { push: vi.fn(), replace: vi.fn() }
  navigateToHostStackRoute(harness.navigation, router, target.hostId, target.sessionTarget!)
  expect(router.push).toHaveBeenCalledOnce()
  expect(harness.navigation.dispatch).not.toHaveBeenCalled()
})
