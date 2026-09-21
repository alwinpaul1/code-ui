import { beforeEach, describe, expect, it, vi } from 'vitest'
import { subscribeToDesktopNotifications } from './mobile-notifications'
import { resetHostNotificationSessionsForTests } from './notification-reconnect-catchup'
import type { RpcClient } from '../transport/rpc-client'

vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 'high' },
  deleteNotificationChannelAsync: vi.fn(async () => {}),
  setNotificationChannelAsync: vi.fn(async () => {}),
  getPermissionsAsync: vi.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: vi.fn(async () => ({ status: 'granted' })),
  scheduleNotificationAsync: vi.fn(async () => 'id'),
  dismissNotificationAsync: vi.fn(async () => {})
}))
vi.mock('react-native', () => ({ AppState: { currentState: 'background' }, Platform: { OS: 'android', Version: 34 } }))
vi.mock('../storage/preferences', () => ({ loadPushNotificationsEnabled: vi.fn(async () => true) }))

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

const { recordDeliveredPush, resetDeliveredPushCacheForTests } = await import(
  './push-delivery-log'
)

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20))
}

function makeHostClient() {
  let onData: ((data: unknown) => void) | null = null
  const missedParams: unknown[] = []
  const client = {
    subscribe: vi.fn((_m: string, _p: unknown, cb: (data: unknown) => void) => {
      onData = cb
      return vi.fn()
    }),
    getState: vi.fn(() => 'connected'),
    sendRequest: vi.fn(async (method: string, params: unknown = {}) => {
      if (method === 'notifications.getMissedSince') {
        missedParams.push(params)
        return { ok: true, result: { notifications: [], epoch: 'epoch-1' } }
      }
      return { ok: true, result: undefined }
    })
  } as unknown as RpcClient
  return {
    client,
    missedParams,
    ready: () => onData?.({ type: 'ready', subscriptionId: 's-1', epoch: 'epoch-1' })
  }
}

/**
 * A push that arrived while the app was dead already showed its banner. The
 * desktop has no way to know that, so unless the catch-up says so it replays the
 * notification on the next connection and the reader gets it a second time.
 * `deliveredPushes` is the field the desktop's contract provides for saying it.
 */
describe('telling the desktop which notifications a push already delivered', () => {
  beforeEach(() => {
    storage.clear()
    resetHostNotificationSessionsForTests()
    resetDeliveredPushCacheForTests()
    vi.clearAllMocks()
  })

  it('reports a push that landed while the app was dead', async () => {
    await recordDeliveredPush('host-1', {
      notificationId: 'n-7',
      notificationEpoch: 'epoch-1',
      notificationSeq: 7
    })
    // The device has delivered for this host before, so a cold open catches up.
    storage.set(
      'orca:mobileNotificationsWatermark:host-1',
      JSON.stringify({ seq: 3, epoch: 'epoch-1' })
    )
    const host = makeHostClient()
    subscribeToDesktopNotifications(host.client, 'host-1')
    await flushAsync()
    host.ready()
    await flushAsync()

    expect(host.missedParams[0]).toMatchObject({
      lastSeenSeq: 3,
      deliveredPushes: [{ notificationId: 'n-7', notificationEpoch: 'epoch-1', notificationSeq: 7 }]
    })
  })

  // The desktop already cuts by seq, so an entry at or below the watermark is
  // redundant. Pruning keeps the request small without assuming anything about
  // what the desktop does with the field.
  it('leaves out a push the watermark already covers', async () => {
    await recordDeliveredPush('host-1', {
      notificationId: 'n-2',
      notificationEpoch: 'epoch-1',
      notificationSeq: 2
    })
    storage.set(
      'orca:mobileNotificationsWatermark:host-1',
      JSON.stringify({ seq: 5, epoch: 'epoch-1' })
    )
    const host = makeHostClient()
    subscribeToDesktopNotifications(host.client, 'host-1')
    await flushAsync()
    host.ready()
    await flushAsync()

    expect(host.missedParams[0]).not.toHaveProperty('deliveredPushes')
  })

  // The case that matters: the process that showed the push is gone, so nothing
  // is in memory and the record exists only in storage. If the seed does not warm
  // the cache before the catch-up asks, the desktop replays the notification and
  // the reader sees it a second time.
  it('reports a push recorded by a process that has already exited', async () => {
    await recordDeliveredPush('host-1', {
      notificationId: 'n-9',
      notificationEpoch: 'epoch-1',
      notificationSeq: 9
    })
    storage.set(
      'orca:mobileNotificationsWatermark:host-1',
      JSON.stringify({ seq: 3, epoch: 'epoch-1' })
    )
    // The app was killed after that push; this open starts with a cold cache.
    resetDeliveredPushCacheForTests()

    const host = makeHostClient()
    subscribeToDesktopNotifications(host.client, 'host-1')
    await flushAsync()
    host.ready()
    await flushAsync()

    expect(host.missedParams[0]).toMatchObject({
      deliveredPushes: [{ notificationId: 'n-9', notificationEpoch: 'epoch-1', notificationSeq: 9 }]
    })
  })

  it('omits the field entirely when no push has been delivered', async () => {
    storage.set(
      'orca:mobileNotificationsWatermark:host-1',
      JSON.stringify({ seq: 3, epoch: 'epoch-1' })
    )
    const host = makeHostClient()
    subscribeToDesktopNotifications(host.client, 'host-1')
    await flushAsync()
    host.ready()
    await flushAsync()

    expect(host.missedParams[0]).not.toHaveProperty('deliveredPushes')
  })
})
