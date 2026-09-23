import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Notifications from 'expo-notifications'
import AsyncStorage from '@react-native-async-storage/async-storage'
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
// withdrawn), every word a session had already moved past, and — because the
// seen-set died with the process while the watermark may lag — notifications the
// previous run had already shown.
vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 'high' },
  deleteNotificationChannelAsync: vi.fn(async () => {}),
  setNotificationChannelAsync: vi.fn(async () => undefined),
  setNotificationCategoryAsync: vi.fn(async () => undefined),
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  getPresentedNotificationsAsync: vi.fn(async () => []),
  scheduleNotificationAsync: vi.fn(),
  dismissNotificationAsync: vi.fn(async () => undefined)
}))
// Background, and never foregrounded: the replay the shade actually receives.
// With the app open the replay was already quiet (notification-catchup-foreground).
vi.mock('react-native', () => ({
  AppState: { currentState: 'background', addEventListener: vi.fn() },
  Platform: { OS: 'android', Version: 34 }
}))
const WATERMARK_KEY = 'orca:mobileNotificationsWatermark:host-1'
const SEEN_KEY = 'orca:mobileNotificationsSeen:host-1'
const storage = new Map<string, string>()
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value)
    }),
    removeItem: vi.fn(async (key: string) => {
      storage.delete(key)
    })
  }
}))
vi.mock('../storage/preferences', () => ({
  loadPushNotificationsEnabled: vi.fn()
}))

async function flush(): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function persistedSeq(): number {
  return (JSON.parse(storage.get(WATERMARK_KEY) ?? '{}') as { seq?: number }).seq ?? 0
}

function notification(seq: number, worktreeId: string, body = `event ${seq}`) {
  return {
    type: 'notification',
    source: 'agent-task-complete',
    title: `NexOS / ${worktreeId} · Claude finished`,
    body,
    worktreeId,
    notificationId: `agent:${seq}`,
    notificationSeq: seq,
    notificationEpoch: 'epoch-1'
  }
}

function dismiss(seq: number, notificationId: string) {
  return { type: 'dismiss', notificationId, notificationSeq: seq, notificationEpoch: 'epoch-1' }
}

/** What each agent terminal says it is doing right now, for the prompt lookup. */
type AgentNow = { state: string; interactivePrompt?: string }

type Host = { emit: (data: unknown) => void; unsubscribe: () => void }

/** One app process's subscription to host-1, answering catch-ups with `missed`. */
function connect(missed: unknown[], agentNow: AgentNow = { state: 'done' }): Host {
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
  const unsubscribe = subscribeToDesktopNotifications(client, 'host-1')
  onEvent!({ type: 'ready', subscriptionId: 'sub-1', epoch: 'epoch-1' })
  return { emit: (data) => onEvent!(data), unsubscribe }
}

/** A cold open of a device that has delivered for this host before. */
function restartAgainst(missed: unknown[], agentNow?: AgentNow): Host {
  storage.set(WATERMARK_KEY, JSON.stringify({ seq: 5, epoch: 'epoch-1' }))
  return connect(missed, agentNow)
}

/** The process dies: everything in memory goes, storage stays. */
function killProcess(): void {
  resetHostNotificationSessionsForTests()
  vi.mocked(Notifications.scheduleNotificationAsync).mockClear()
  vi.mocked(Notifications.dismissNotificationAsync).mockClear()
}

function postedBodies(): string[] {
  return vi
    .mocked(Notifications.scheduleNotificationAsync)
    .mock.calls.map((call) => String(call[0]?.content?.body ?? ''))
}

describe('the replay after a restart', () => {
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
    // As expo does: a request that names an identifier is scheduled under it.
    vi.mocked(Notifications.scheduleNotificationAsync).mockImplementation(
      async (request) => request.identifier ?? 'anonymous'
    )
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('posts only what is still news after a long session, and moves the watermark past all of it', async () => {
    restartAgainst([
      // Dealt with at the desk: its dismiss is later in the same replay.
      notification(6, 'wt-auth', 'auth: finished'),
      dismiss(7, 'agent:6'),
      // Spoke twice: only the second is still on screen once both land.
      notification(8, 'wt-billing', 'billing: first'),
      notification(9, 'wt-billing', 'billing: second'),
      notification(10, 'wt-search', 'search: finished')
    ])
    await flush()

    expect(postedBodies()).toEqual(['billing: second', 'search: finished'])
    expect(persistedSeq()).toBe(10)
  })

  it('does not pop a notification the desk dismissed', async () => {
    restartAgainst([notification(6, 'wt-auth'), dismiss(7, 'agent:6')])
    await flush()

    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled()
    expect(persistedSeq()).toBe(7)
  })

  it('posts one banner for a session that spoke several times, carrying its latest word', async () => {
    restartAgainst([
      notification(6, 'wt-auth', 'auth: first'),
      notification(7, 'wt-auth', 'auth: second'),
      notification(8, 'wt-auth', 'auth: third')
    ])
    await flush()

    expect(postedBodies()).toEqual(['auth: third'])
    expect(persistedSeq()).toBe(8)
  })

  it('still posts a notification missed long ago that the desk never acknowledged', async () => {
    // The Doze case: the socket was silent for an hour and this catch-up is the
    // only way the notification reaches the phone. No dismiss means the desk
    // has not dealt with it, however old it is.
    restartAgainst([{ ...notification(6, 'wt-auth', 'auth: finished'), emittedAt: 0 }])
    await flush()

    expect(postedBodies()).toEqual(['auth: finished'])
    expect(persistedSeq()).toBe(6)
  })

  it('still pops an ask the agent is waiting on right now, with its buttons', async () => {
    restartAgainst([notification(6, 'wt-auth')], {
      state: 'waiting',
      interactivePrompt: JSON.stringify({ approval: { tool: 'Bash', summary: 'pnpm test' } })
    })
    await flush()

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1)
    const content = vi.mocked(Notifications.scheduleNotificationAsync).mock.calls[0]![0]!.content
    expect(content.categoryIdentifier).toEqual(expect.stringContaining('codeui-permission-'))
    expect(persistedSeq()).toBe(6)
  })

  it('does not re-post after a restart what the previous run already showed, even from a lagging watermark', async () => {
    // Run 1 shows two notifications live.
    const first = restartAgainst([])
    await flush()
    first.emit(notification(6, 'wt-auth', 'auth: finished'))
    first.emit(notification(7, 'wt-billing', 'billing: finished'))
    await flush()
    expect(postedBodies()).toEqual(['auth: finished', 'billing: finished'])

    // The watermark on disk lags what was shown, as a failed catch-up's
    // quarantine leaves it; then the process dies.
    killProcess()
    storage.set(WATERMARK_KEY, JSON.stringify({ seq: 5, epoch: 'epoch-1' }))

    // Run 2 asks from 5, and the desktop replays both.
    connect([notification(6, 'wt-auth', 'auth: finished'), notification(7, 'wt-billing', 'billing: finished')])
    await flush()

    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled()
    // Delivered is delivered: the watermark catches up, so the next restart asks from 7.
    expect(persistedSeq()).toBe(7)
  })

  it('still posts, after a restart, what the previous run never showed', async () => {
    const first = restartAgainst([])
    await flush()
    first.emit(notification(6, 'wt-auth', 'auth: finished'))
    await flush()
    killProcess()
    storage.set(WATERMARK_KEY, JSON.stringify({ seq: 5, epoch: 'epoch-1' }))

    connect([notification(6, 'wt-auth', 'auth: finished'), notification(7, 'wt-billing', 'billing: finished')])
    await flush()

    expect(postedBodies()).toEqual(['billing: finished'])
    expect(persistedSeq()).toBe(7)
  })

  it('ignores stored keys from another desktop lifetime, where the same seqs mean other notifications', async () => {
    storage.set(SEEN_KEY, JSON.stringify({ epoch: 'epoch-0', keys: ['id:agent:6#6'] }))
    restartAgainst([notification(6, 'wt-auth', 'auth: finished')])
    await flush()

    expect(postedBodies()).toEqual(['auth: finished'])
  })

  it('posts as before when the stored keys cannot be read', async () => {
    const getItem = vi.mocked(AsyncStorage.getItem)
    const original = getItem.getMockImplementation()!
    getItem.mockImplementation(async (key: string) => {
      if (key === SEEN_KEY) {
        throw new Error('storage unavailable')
      }
      return original(key)
    })
    restartAgainst([notification(6, 'wt-auth', 'auth: finished')])
    await flush()

    expect(postedBodies()).toEqual(['auth: finished'])
    expect(persistedSeq()).toBe(6)
  })

  it('posts as before when the stored keys are garbled', async () => {
    storage.set(SEEN_KEY, '{"epoch":')
    restartAgainst([notification(6, 'wt-auth', 'auth: finished')])
    await flush()

    expect(postedBodies()).toEqual(['auth: finished'])
  })

  it('clears the session banner a previous run left in the tray when its last replayed word was dismissed', async () => {
    // The old flow ended here too: the word posted on the session identifier,
    // replacing the stale banner, and its dismiss cleared it. Now without the popup.
    restartAgainst([notification(6, 'wt-auth'), dismiss(7, 'agent:6')])
    await flush()

    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('codeui:host-1:wt-auth')
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled()
  })

  it('does not clear a banner this run posted itself when a replayed word of its session was dismissed', async () => {
    // Posted live on wt-auth, still undismissed at the desk.
    const first = restartAgainst([])
    await flush()
    first.emit(notification(6, 'wt-auth', 'auth: live'))
    await flush()
    first.unsubscribe()

    // Reconnect in the same process: a later word of the session came and went.
    connect([notification(7, 'wt-auth'), dismiss(8, 'agent:7')])
    await flush()

    expect(Notifications.dismissNotificationAsync).not.toHaveBeenCalledWith('codeui:host-1:wt-auth')
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

  it('posts nothing and keeps the watermark for an empty replay', async () => {
    restartAgainst([])
    await flush()

    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled()
    expect(persistedSeq()).toBe(5)
  })

  it('posts the one event of a one-event replay', async () => {
    restartAgainst([notification(6, 'wt-auth', 'auth: finished')])
    await flush()

    expect(postedBodies()).toEqual(['auth: finished'])
    expect(persistedSeq()).toBe(6)
  })
})
