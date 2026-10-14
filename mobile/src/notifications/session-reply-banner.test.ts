import * as Notifications from 'expo-notifications'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  deleteNotificationChannelAsync: vi.fn(async () => {}),
  setNotificationChannelAsync: vi.fn(async () => undefined),
  setNotificationCategoryAsync: vi.fn(async () => undefined),
  scheduleNotificationAsync: vi.fn(async () => 'scheduled-1'),
  dismissNotificationAsync: vi.fn(async () => {}),
  getAllScheduledNotificationsAsync: vi.fn(async () => []),
  getPresentedNotificationsAsync: vi.fn(async () => [])
}))
vi.mock('react-native', () => ({ AppState: { currentState: 'background' }, Platform: { OS: 'android' } }))
vi.mock('../storage/preferences', () => ({ loadPushNotificationsEnabled: vi.fn(async () => true) }))
vi.mock('./notification-permissions', () => ({ ensureNotificationPermissions: vi.fn(async () => true) }))
const host = vi.hoisted(() => ({ pending: null as unknown }))
vi.mock('./permission-lookup', () => ({ lookupPendingPrompt: vi.fn(async () => host.pending) }))
vi.mock('../transport/live-host-clients', () => ({ peekLiveHostClient: () => ({ getState: () => 'connected' }) }))

import { showLocalNotification } from './local-notification-scheduling'
import { resetPermissionCategoriesForTests } from './permission-notification-category'
import { resetWorktreeLaunchAgentsForTests } from './worktree-launch-agents'

const PANE_ID = 'agent:wt-1:tab-1%3Aleaf-1:123'

function finished(notificationId = PANE_ID) {
  return {
    type: 'notification' as const,
    source: 'agent-task-complete' as const,
    title: 'repo / main - Claude finished',
    body: 'Added the retry budget.',
    worktreeId: 'wt-1',
    notificationId
  }
}

function posted() {
  const calls = vi.mocked(Notifications.scheduleNotificationAsync).mock.calls
  return calls.at(-1)![0] as unknown as { content: { categoryIdentifier?: string; data: Record<string, unknown> } }
}

beforeEach(() => {
  vi.clearAllMocks()
  host.pending = null
  resetPermissionCategoriesForTests()
  resetWorktreeLaunchAgentsForTests()
})

// A finished session's banner, as it reaches the shade: the Reply button (the Claude app's, with the
// hint "Reply to Claude") is on it when the reply can be routed back to the tab, and a banner that
// already carries a permission or a question to answer keeps those buttons instead.
describe('a finished session’s banner', () => {
  it('carries a Reply button whose field says "Reply to Claude"', async () => {
    await showLocalNotification(finished(), 'host-1')
    expect(Notifications.setNotificationCategoryAsync).toHaveBeenCalledWith(
      expect.stringContaining('session-reply'),
      [
        {
          identifier: 'session-reply',
          buttonTitle: 'Reply',
          textInput: { submitButtonTitle: 'Send', placeholder: 'Reply to Claude' },
          options: { opensAppToForeground: false }
        }
      ]
    )
    expect(posted().content.categoryIdentifier).toContain('session-reply')
  })

  it('keeps the routing a tap on the banner’s body uses, and the pane the reply is routed by', async () => {
    await showLocalNotification(finished(), 'host-1')
    expect(posted().content.data).toMatchObject({
      hostId: 'host-1',
      worktreeId: 'wt-1',
      paneKey: 'tab-1:leaf-1'
    })
  })

  it('has no Reply button when its id names no pane to route the words back to', async () => {
    await showLocalNotification(finished('some-other-id'), 'host-1')
    expect(posted().content.categoryIdentifier).toBeUndefined()
    expect(Notifications.setNotificationCategoryAsync).not.toHaveBeenCalled()
  })

  it('keeps its permission buttons, not a Reply, when the agent is waiting on an approval', async () => {
    host.pending = {
      kind: 'permission',
      terminal: 'agent-1',
      agent: 'claude',
      permission: {
        title: 'Allow Bash?',
        detail: 'npm test',
        options: [
          { label: 'Allow', send: '1' },
          { label: 'Deny', send: String.fromCharCode(27) }
        ]
      }
    }
    await showLocalNotification(
      { ...finished(), title: 'repo / main - Claude needs input' },
      'host-1'
    )
    const category = posted().content.categoryIdentifier
    expect(category).toBeDefined()
    expect(category).not.toContain('session-reply')
    expect(category).toContain('permission:0')
  })

  it('is posted without a Reply when the system will not take the category', async () => {
    vi.mocked(Notifications.setNotificationCategoryAsync).mockRejectedValueOnce(new Error('no categories'))
    await showLocalNotification(finished(), 'host-1')
    expect(posted().content.categoryIdentifier).toBeUndefined()
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1)
  })

  // "When I open the app suddenly all the notifications come up" (2026-09-21): a replay drained while
  // the app is open posts only a banner whose buttons ARE the point of it. A Reply field is not that;
  // if it counted, every finished session would pop up again on opening the app.
  it('is still not posted by a replay drained while the app is open', async () => {
    await showLocalNotification(finished(), 'host-1', { quietUnlessActionable: true })
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled()
  })

  it('still posts a permission to approve from that same replay, whose buttons are the point', async () => {
    host.pending = {
      kind: 'permission',
      terminal: 'agent-1',
      agent: 'claude',
      permission: { title: 'Allow Bash?', detail: 'npm test', options: [{ label: 'Allow', send: '1' }, { label: 'Deny', send: String.fromCharCode(27) }] }
    }
    await showLocalNotification({ ...finished(), title: 'repo / main - Claude needs input' }, 'host-1', {
      quietUnlessActionable: true
    })
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1)
  })
})
