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
const appState = vi.hoisted(() => ({ currentState: 'active' }))
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
    appState.currentState = 'background'
    const { onData } = connect()
    onData?.({ type: 'ready', subscriptionId: 'sub-1', epoch: 'epoch-1' })
    await flushAsync()
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(3)
    expect(persistedSeq()).toBe(8)
  })

  it('shows the rest of a replay once the user leaves the app mid-way', async () => {
    appState.currentState = 'active'
    let shown = 0
    vi.mocked(Notifications.scheduleNotificationAsync).mockImplementation(async () => {
      shown += 1
      return 'sched-1'
    })
    const { onData } = connect()
    // The first event drains with the app open; the user backgrounds it before
    // the second lands.
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
    await flushAsync()
    expect(shown).toBe(2)
    expect(persistedSeq()).toBe(8)
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
