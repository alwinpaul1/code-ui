import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Notifications from 'expo-notifications'
import type { RpcClient } from '../transport/rpc-client'
import { clearLiveHostClientsForTest } from '../transport/live-host-clients'
import { loadPushNotificationsEnabled } from '../storage/preferences'
import { subscribeToDesktopNotifications } from './mobile-notifications'
import { resetHostNotificationSessionsForTests } from './notification-reconnect-catchup'

// 2026-09-23, the user: "after the app is restarted .. after a long session all
// the old pop ups come up which were resolved already making unwanted popups on
// the notification bar". A restart reconnects, the reconnect asks the desktop
// for everything past the stored watermark, and the desktop keeps up to 256
// events. Every one of them was posted as a banner: those the desk had already
// dismissed (their dismiss sits later in the same replay, so each popped and was
// withdrawn), every word a session had already moved past, and events hours old.
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
// Background, and never foregrounded: the replay the shade actually receives.
// With the app open the replay was already quiet (notification-catchup-foreground).
vi.mock('react-native', () => ({
  AppState: { currentState: 'background', addEventListener: vi.fn() },
  Platform: { OS: 'android', Version: 34 }
}))
const WATERMARK_KEY = 'orca:mobileNotificationsWatermark:host-1'
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

const NOW = Date.parse('2026-09-23T14:00:00Z')
const MINUTE = 60_000

async function flush(): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function persistedSeq(): number {
  return (JSON.parse(storage.get(WATERMARK_KEY) ?? '{}') as { seq?: number }).seq ?? 0
}

function notification(seq: number, worktreeId: string, minutesAgo: number, body = `event ${seq}`) {
  return {
    type: 'notification',
    source: 'agent-task-complete',
    title: `NexOS / ${worktreeId} · Claude finished`,
    body,
    worktreeId,
    notificationId: `agent:${seq}`,
    notificationSeq: seq,
    notificationEpoch: 'epoch-1',
    emittedAt: NOW - minutesAgo * MINUTE
  }
}

function dismiss(seq: number, notificationId: string) {
  return { type: 'dismiss', notificationId, notificationSeq: seq, notificationEpoch: 'epoch-1' }
}

/** What each agent terminal says it is doing right now, for the prompt lookup. */
type AgentNow = { state: string; interactivePrompt?: string }

function restartAgainst(missed: unknown[], agentNow: AgentNow = { state: 'done' }): void {
  let onEvent: ((data: unknown) => void) | null = null
  const client = {
    subscribe: vi.fn((_method: string, _params: unknown, callback: (data: unknown) => void) => {
      onEvent = callback
      return vi.fn()
    }),
    getState: vi.fn(() => 'connected'),
    sendRequest: vi.fn(async (method: string) => {
      if (method === 'notifications.getMissedSince') {
        return { ok: true, result: { notifications: missed, epoch: 'epoch-1' } }
      }
      if (method === 'terminal.list') {
        return { ok: true, result: { terminals: [{ handle: 'term-1', agentIdentity: 'claude' }] } }
      }
      if (method === 'terminal.agentStatus') {
        return { ok: true, result: { agentStatus: agentNow } }
      }
      return { ok: true, result: {} }
    })
  } as unknown as RpcClient
  // A device that has delivered for this host before: the cold open catches up.
  storage.set(WATERMARK_KEY, JSON.stringify({ seq: 5, epoch: 'epoch-1' }))
  subscribeToDesktopNotifications(client, 'host-1')
  onEvent!({ type: 'ready', subscriptionId: 'sub-1', epoch: 'epoch-1' })
}

function postedBodies(): string[] {
  return vi
    .mocked(Notifications.scheduleNotificationAsync)
    .mock.calls.map((call) => String(call[0]?.content?.body ?? ''))
}

describe('the replay after a restart', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    storage.clear()
    clearLiveHostClientsForTest()
    resetHostNotificationSessionsForTests()
    vi.mocked(loadPushNotificationsEnabled).mockResolvedValue(true)
    vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      status: 'granted',
      canAskAgain: true
    } as never)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('posts only what is still news after a long session, and moves the watermark past all of it', async () => {
    restartAgainst([
      // Dealt with at the desk: its dismiss is later in the same replay.
      notification(6, 'wt-auth', 120, 'auth: finished'),
      dismiss(7, 'agent:6'),
      // Spoke twice, both long ago.
      notification(8, 'wt-billing', 95, 'billing: first'),
      notification(9, 'wt-billing', 80, 'billing: second'),
      // Minutes ago: genuinely missed, still news.
      notification(10, 'wt-search', 2, 'search: finished')
    ])
    await flush()

    expect(postedBodies()).toEqual(['search: finished'])
    expect(persistedSeq()).toBe(10)
  })

  it('posts nothing for a replay that is all old news, and still moves the watermark', async () => {
    restartAgainst([notification(6, 'wt-auth', 45), notification(7, 'wt-billing', 30)])
    await flush()

    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled()
    expect(persistedSeq()).toBe(7)
  })

  it('does not pop a notification the desk dismissed, however recent', async () => {
    restartAgainst([notification(6, 'wt-auth', 1), dismiss(7, 'agent:6')])
    await flush()

    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled()
    expect(persistedSeq()).toBe(7)
  })

  it('posts one banner for a session that spoke several times, carrying its latest word', async () => {
    restartAgainst([
      notification(6, 'wt-auth', 3, 'auth: first'),
      notification(7, 'wt-auth', 2, 'auth: second'),
      notification(8, 'wt-auth', 1, 'auth: third')
    ])
    await flush()

    expect(postedBodies()).toEqual(['auth: third'])
    expect(persistedSeq()).toBe(8)
  })

  it('still pops an old ask the agent is waiting on right now, with its buttons', async () => {
    // Not stale: nobody has answered it. The lookup says the agent is paused on
    // this prompt now, which is what an unresolved notification is.
    restartAgainst([notification(6, 'wt-auth', 90)], {
      state: 'waiting',
      interactivePrompt: JSON.stringify({ approval: { tool: 'Bash', summary: 'pnpm test' } })
    })
    await flush()

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1)
    const content = vi.mocked(Notifications.scheduleNotificationAsync).mock.calls[0]![0]!.content
    expect(content.categoryIdentifier).toEqual(expect.stringContaining('codeui-permission-'))
    expect(persistedSeq()).toBe(6)
  })

  it('still clears a banner the previous run left in the tray when the replay carries its dismiss', async () => {
    vi.mocked(Notifications.getPresentedNotificationsAsync).mockResolvedValue([
      {
        request: {
          identifier: 'codeui:host-1:wt-auth',
          content: { data: { hostId: 'host-1', notificationId: 'agent:4' } }
        }
      }
    ] as never)
    restartAgainst([dismiss(6, 'agent:4')])
    await flush()

    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('codeui:host-1:wt-auth')
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled()
    expect(persistedSeq()).toBe(6)
  })

  it('keeps showing a replay from a desktop that sends no emittedAt, as before', async () => {
    const { emittedAt: _dropped, ...undated } = notification(6, 'wt-auth', 300)
    restartAgainst([undated])
    await flush()

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1)
  })

  it('posts nothing and keeps the watermark for an empty replay', async () => {
    restartAgainst([])
    await flush()

    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled()
    expect(persistedSeq()).toBe(5)
  })

  it('posts the one event of a one-event replay that is still news', async () => {
    restartAgainst([notification(6, 'wt-auth', 1, 'auth: finished')])
    await flush()

    expect(postedBodies()).toEqual(['auth: finished'])
    expect(persistedSeq()).toBe(6)
  })
})
