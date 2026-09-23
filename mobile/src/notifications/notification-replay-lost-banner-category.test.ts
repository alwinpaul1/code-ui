import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Notifications from 'expo-notifications'
import type { RpcClient } from '../transport/rpc-client'
import { clearLiveHostClientsForTest } from '../transport/live-host-clients'
import { loadPushNotificationsEnabled } from '../storage/preferences'
import { subscribeToDesktopNotifications } from './mobile-notifications'
import { resetHostNotificationSessionsForTests } from './notification-reconnect-catchup'

// Its own module because ensurePermissionCategory caches registrations at module
// scope, and this case needs the OS to refuse one. The rest of these guards are
// in notification-replay-lost-banner-guards.test.ts.
vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 'high' },
  deleteNotificationChannelAsync: vi.fn(async () => {}),
  setNotificationChannelAsync: vi.fn(async () => undefined),
  setNotificationCategoryAsync: vi.fn(async () => undefined),
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  getPresentedNotificationsAsync: vi.fn(async () => []),
  scheduleNotificationAsync: vi.fn(async () => 'scheduled-1'),
  dismissNotificationAsync: vi.fn(async () => undefined)
}))
vi.mock('react-native', () => ({
  AppState: { currentState: 'background', addEventListener: vi.fn() },
  Platform: { OS: 'android', Version: 34 }
}))
const storage = new Map<string, string>()
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value)
    }),
    removeItem: vi.fn(async () => undefined)
  }
}))
vi.mock('../storage/preferences', () => ({
  loadPushNotificationsEnabled: vi.fn()
}))

async function flush(): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

describe('a replay never drops a banner the user needs, when the OS refuses the buttons', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storage.clear()
    clearLiveHostClientsForTest()
    resetHostNotificationSessionsForTests()
    vi.mocked(loadPushNotificationsEnabled).mockResolvedValue(true)
    vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      status: 'granted',
      canAskAgain: true
    } as never)
    vi.mocked(Notifications.setNotificationCategoryAsync).mockRejectedValue(new Error('no category'))
  })

  it('still posts an old ask the agent is paused on when the OS refuses the action set', async () => {
    let onEvent: ((data: unknown) => void) | null = null
    const client = {
      subscribe: vi.fn((_method: string, _params: unknown, callback: (data: unknown) => void) => {
        onEvent = callback
        return vi.fn()
      }),
      getState: vi.fn(() => 'connected'),
      sendRequest: vi.fn(async (method: string) => {
        if (method === 'notifications.getMissedSince') {
          const ask = {
            type: 'notification',
            source: 'agent-task-complete',
            title: 'NexOS / wt-x - Claude needs input',
            body: 'x: needs permission',
            worktreeId: 'wt-x',
            notificationId: 'agent:6',
            notificationSeq: 6,
            notificationEpoch: 'epoch-1',
            emittedAt: Date.now() - 30 * 60_000
          }
          return { ok: true, result: { notifications: [ask], epoch: 'epoch-1' } }
        }
        if (method === 'terminal.list') {
          return { ok: true, result: { terminals: [{ handle: 'term-1', agentIdentity: 'claude' }] } }
        }
        if (method === 'terminal.agentStatus') {
          return {
            ok: true,
            result: {
              agentStatus: {
                state: 'waiting',
                interactivePrompt: JSON.stringify({ approval: { tool: 'Bash', summary: 'pnpm test' } })
              }
            }
          }
        }
        return { ok: true, result: {} }
      })
    } as unknown as RpcClient
    storage.set('orca:mobileNotificationsWatermark:host-1', JSON.stringify({ seq: 5, epoch: 'epoch-1' }))
    subscribeToDesktopNotifications(client, 'host-1')
    onEvent!({ type: 'ready', subscriptionId: 'sub-1', epoch: 'epoch-1' })
    await flush()

    // decorateWithPrompt: "The buttons are the point. Without them, the caption
    // alone is still an improvement, so keep it and drop only the actions."
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1)
  })
})
