import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Notifications from 'expo-notifications'
import { subscribeToDesktopNotifications } from './mobile-notifications'
import { resetHostNotificationSessionsForTests } from './notification-reconnect-catchup'
import type { RpcClient } from '../transport/rpc-client'
import { loadPushNotificationsEnabled } from '../storage/preferences'

// 2026-09-21, the user: "when I open the app suddenly all the notifications come
// up". The socket dies while the app is in the background, so nothing arrives
// until the app is opened; the reconnect then replays every missed event as a
// banner — while the user is already looking at the app. A banner for something
// the open screen shows is noise; the replay's job in the foreground is to
// bring the watermark up to date. Missed events replayed while the app is still
// in the background (a socket that came back on its own) are still shown: that
// is the case the catch-up exists for.
vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 'high' },
  deleteNotificationChannelAsync: vi.fn(async () => {}),
  setNotificationChannelAsync: vi.fn(async () => {}),
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  dismissNotificationAsync: vi.fn()
}))
const appState = vi.hoisted(() => {
  const listeners = new Set<(state: string) => void>()
  return {
    currentState: 'active',
    addEventListener: (_type: string, listener: (state: string) => void) => {
      listeners.add(listener)
      return { remove: () => listeners.delete(listener) }
    },
    emit(state: string) {
      for (const listener of listeners) listener(state)
    }
  }
})
vi.mock('react-native', () => ({
  Platform: { OS: 'android', Version: 34 },
  AppState: appState
}))

const WATERMARK_KEY = 'orca:mobileNotificationsWatermark:host-1'
const storage = new Map<string, string>()
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value)
    })
  }
}))
vi.mock('../storage/preferences', () => ({
  loadPushNotificationsEnabled: vi.fn()
}))

function flushAsync(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 20)
  })
}
function persistedSeq(): number {
  return (JSON.parse(storage.get(WATERMARK_KEY) ?? '{}') as { seq?: number }).seq ?? 0
}

const missed = [6, 7, 8].map((seq) => ({
  type: 'notification',
  source: 'agent-task-complete',
  title: `NexOS / main`,
  body: `Claude finished ${seq}`,
  worktreeId: `w${seq}`,
  notificationId: `a:${seq}`,
  notificationSeq: seq
}))

function connect(): { onData: ((data: unknown) => void) | null } {
  const handle: { onData: ((data: unknown) => void) | null } = { onData: null }
  const client = {
    subscribe: vi.fn((_m: string, _p: unknown, cb: (data: unknown) => void) => {
      handle.onData = cb
      return vi.fn()
    }),
    getState: vi.fn(() => 'connected'),
    sendRequest: vi.fn(async (method: string) => {
      if (method === 'notifications.getMissedSince') {
        return { ok: true, result: { notifications: missed, epoch: 'epoch-1' } } as never
      }
      return { ok: true, result: undefined } as never
    })
  } as unknown as RpcClient
  storage.set(WATERMARK_KEY, JSON.stringify({ seq: 5, epoch: 'epoch-1' }))
  subscribeToDesktopNotifications(client, 'host-1')
  return handle
}

describe('a reconnect catch-up while the app is open', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storage.clear()
    resetHostNotificationSessionsForTests()
    vi.mocked(loadPushNotificationsEnabled).mockResolvedValue(true)
    vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ status: 'granted', canAskAgain: true } as never)
    vi.mocked(Notifications.scheduleNotificationAsync).mockResolvedValue('sched-1')
    vi.mocked(Notifications.dismissNotificationAsync).mockResolvedValue(undefined)
  })

  it('posts no banner for what was missed, and still moves the watermark past it', async () => {
    appState.currentState = 'active'
    const { onData } = connect()
    onData?.({ type: 'ready', subscriptionId: 'sub-1', epoch: 'epoch-1' })
    await flushAsync()
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled()
    expect(persistedSeq()).toBe(8)
  })

  it('still shows what was missed when the socket came back with the app in the background', async () => {
    vi.useFakeTimers()
    appState.currentState = 'background'
    // Well past any foregrounding: a socket that came back on its own.
    vi.advanceTimersByTime(20_000)
    const { onData } = connect()
    onData?.({ type: 'ready', subscriptionId: 'sub-1', epoch: 'epoch-1' })
    await vi.advanceTimersByTimeAsync(50)
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(3)
    expect(persistedSeq()).toBe(8)
    vi.useRealTimers()
  })

  // 2026-09-21, phone notification log: the app was opened cold at 20:51:44 and
  // three banners for events 6–40 minutes old posted within 13 s, on the build
  // that already had the active-state rule. React Native on Android can report
  // 'background' for the first moments of a cold start, before the first state
  // event lands — which is when the reconnect replay runs. An app that came to
  // the foreground within the last few seconds is open, whatever the field says.
  it('is quiet when the app came to the foreground seconds ago, even if the state field still reads background', async () => {
    vi.useFakeTimers()
    appState.currentState = 'background'
    appState.emit('active')
    appState.currentState = 'background'
    const { onData } = connect()
    onData?.({ type: 'ready', subscriptionId: 'sub-1', epoch: 'epoch-1' })
    await vi.advanceTimersByTimeAsync(50)
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled()
    expect(persistedSeq()).toBe(8)
    vi.useRealTimers()
  })

  it('shows a background replay once the last foregrounding is well past', async () => {
    vi.useFakeTimers()
    appState.emit('active')
    appState.currentState = 'background'
    vi.advanceTimersByTime(20_000)
    const { onData } = connect()
    onData?.({ type: 'ready', subscriptionId: 'sub-1', epoch: 'epoch-1' })
    await vi.advanceTimersByTimeAsync(50)
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(3)
    vi.useRealTimers()
  })

  it('shows the rest of a replay once the user leaves the app mid-way, past the grace', async () => {
    vi.useFakeTimers()
    appState.currentState = 'active'
    vi.advanceTimersByTime(20_000)
    let shown = 0
    vi.mocked(Notifications.scheduleNotificationAsync).mockImplementation(async () => {
      shown += 1
      return 'sched-1'
    })
    const { onData } = connect()
    let delivered = 0
    const original = vi.mocked(Notifications.getPermissionsAsync).getMockImplementation()
    vi.mocked(Notifications.getPermissionsAsync).mockImplementation(async (...args) => {
      delivered += 1
      if (delivered === 1) {
        appState.currentState = 'background'
      }
      return original ? original(...args) : ({ status: 'granted', canAskAgain: true } as never)
    })
    onData?.({ type: 'ready', subscriptionId: 'sub-1', epoch: 'epoch-1' })
    await vi.advanceTimersByTimeAsync(50)
    expect(shown).toBe(2)
    expect(persistedSeq()).toBe(8)
    vi.useRealTimers()
  })

  it('still shows a live event that arrives while the app is open', async () => {
    // Not a catch-up: the user asked to hear when an agent in another tab
    // finishes, and Android decides whether a foreground banner pops.
    appState.currentState = 'active'
    const { onData } = connect()
    onData?.({ type: 'ready', subscriptionId: 'sub-1', epoch: 'epoch-1' })
    await flushAsync()
    onData?.({ ...missed[0], notificationId: 'a:9', notificationSeq: 9, worktreeId: 'w9' })
    await flushAsync()
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1)
  })
})
