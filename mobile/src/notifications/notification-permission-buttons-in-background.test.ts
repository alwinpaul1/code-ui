import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import type { RpcClient } from '../transport/rpc-client'
import { clearLiveHostClientsForTest } from '../transport/live-host-clients'
import { loadPushNotificationsEnabled } from '../storage/preferences'
import { subscribeToDesktopNotifications } from './mobile-notifications'
import { resetHostNotificationSessionsForTests } from './notification-reconnect-catchup'

vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 'high' },
  deleteNotificationChannelAsync: vi.fn(async () => {}),
  setNotificationChannelAsync: vi.fn(async () => undefined),
  setNotificationCategoryAsync: vi.fn(async () => undefined),
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(async () => 'scheduled-1'),
  dismissNotificationAsync: vi.fn()
}))
vi.mock('react-native', () => ({
  AppState: { currentState: 'background' },
  Platform: { OS: 'android', Version: 34 }
}))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined)
  }
}))
vi.mock('../storage/preferences', () => ({
  loadPushNotificationsEnabled: vi.fn()
}))

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/**
 * Reported 2026-09-18 from a friend's phone (Windows host, worktree
 * APPLY_JOBS): "❓ Claude needs input · APPLY_JOBS — Using Bash: cd
 * /d/APPLY_JOBS …" in the shade with no Approve or Deny, on the published
 * 0.7.3. The buttons come from a lookup the phone runs when the event
 * arrives, and that lookup borrowed the UI's client. With the app in the
 * background the UI's relay is suspended and the foreground service listens
 * on a client of its OWN, which the lookup could not see — so the one time a
 * notification matters, the buttons were never there.
 */
describe('permission buttons when only the background link is listening', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearLiveHostClientsForTest()
    resetHostNotificationSessionsForTests()
    Object.assign(Platform, { OS: 'android', Version: 34 })
    vi.mocked(loadPushNotificationsEnabled).mockResolvedValue(true)
    vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      status: 'granted',
      canAskAgain: true
    } as never)
  })

  function watcherClient(): { client: RpcClient; deliver: (event: unknown) => void } {
    let onEvent: ((data: unknown) => void) | null = null
    const client = {
      subscribe: vi.fn((_method: string, _params: unknown, callback: (data: unknown) => void) => {
        onEvent = callback
        return vi.fn()
      }),
      getState: vi.fn(() => 'connected'),
      sendRequest: vi.fn(async (method: string) => {
        if (method === 'terminal.list') {
          return {
            ok: true,
            result: { terminals: [{ handle: 'term-apply-jobs', agentIdentity: 'claude' }] }
          }
        }
        if (method === 'terminal.agentStatus') {
          return {
            ok: true,
            result: {
              agentStatus: {
                state: 'waiting',
                interactivePrompt: JSON.stringify({
                  approval: { tool: 'Bash', summary: 'cd /d/APPLY_JOBS && pdfinfo "$f"' }
                })
              }
            }
          }
        }
        return { ok: true, result: {} }
      })
    } as unknown as RpcClient
    return { client, deliver: (event) => onEvent?.(event) }
  }

  it('hangs Approve and Deny on the banner using the client the event arrived on, with no UI client up', async () => {
    const { client, deliver } = watcherClient()
    subscribeToDesktopNotifications(client, 'host-1')
    deliver({
      type: 'notification',
      source: 'agent-input-needed',
      title: '❓ Claude needs input · APPLY_JOBS',
      body: 'Using Bash: cd /d/APPLY_JOBS f=Danial_Monachan_enercity.pdf pdfinfo "$f"',
      worktreeId: 'repo::/d/APPLY_JOBS',
      notificationId: 'agent:apply-jobs'
    })
    await flush()

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1)
    const content = vi.mocked(Notifications.scheduleNotificationAsync).mock.calls[0]![0]!.content
    expect(content.categoryIdentifier).toEqual(expect.stringContaining('codeui-permission-'))
    // The digit for "Yes" and Escape for "No", keyed by button, ready for the tap.
    expect(content.data).toEqual(
      expect.objectContaining({
        sends: { 'permission:0': '1', 'permission:1': '\u001b' },
        permissionKey: expect.stringContaining('Allow Bash?')
      })
    )
  })

  // The lookup asked the host through the event's own link, not a second one.
  it('asks the host over that same client', async () => {
    const { client, deliver } = watcherClient()
    subscribeToDesktopNotifications(client, 'host-2')
    deliver({
      type: 'notification',
      source: 'agent-input-needed',
      title: 'Claude needs input',
      body: 'Using Bash: ls',
      worktreeId: 'repo::/d/APPLY_JOBS',
      notificationId: 'agent:apply-jobs-2'
    })
    await flush()
    const methods = vi.mocked(client.sendRequest).mock.calls.map((call) => call[0])
    expect(methods).toContain('terminal.list')
    expect(methods).toContain('terminal.agentStatus')
  })
})
