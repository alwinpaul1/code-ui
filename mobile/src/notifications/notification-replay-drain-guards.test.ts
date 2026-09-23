import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Notifications from 'expo-notifications'
import type { RpcClient } from '../transport/rpc-client'
import { clearLiveHostClientsForTest } from '../transport/live-host-clients'
import { loadPushNotificationsEnabled } from '../storage/preferences'
import { subscribeToDesktopNotifications } from './mobile-notifications'
import { resetHostNotificationSessionsForTests } from './notification-reconnect-catchup'

// The replay drain against a tray that behaves like Android's: one banner per
// identifier, a dismiss removes it, getPresented reads it. The first two cases
// were red on 8661544f, where the failure fallback could post a word the desk
// had already dismissed earlier in the same batch.
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
    removeItem: vi.fn(async (key: string) => {
      storage.delete(key)
    })
  }
}))
vi.mock('../storage/preferences', () => ({
  loadPushNotificationsEnabled: vi.fn()
}))

let run = 0
const id = (seq: number) => `agent:r${run}:${seq}`

async function flush(): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}
function persistedSeq(): number {
  return (JSON.parse(storage.get(WATERMARK_KEY) ?? '{}') as { seq?: number }).seq ?? 0
}

function notif(seq: number, worktreeId: string, body = `event ${seq}`, epoch = 'epoch-1', nid = id(seq)) {
  return {
    type: 'notification',
    source: 'agent-task-complete',
    title: `NexOS / ${worktreeId} - Claude finished`,
    body,
    worktreeId,
    notificationId: nid,
    notificationSeq: seq,
    notificationEpoch: epoch
  }
}
function dismiss(seq: number, notificationId: string, epoch = 'epoch-1') {
  return { type: 'dismiss', notificationId, notificationSeq: seq, notificationEpoch: epoch }
}

type Desk = { epoch: string; buffer: unknown[] }
type Host = { emit: (d: unknown) => void; ready: (id?: string) => void; asked: () => number[] }

function connect(desk: Desk): Host {
  let onEvent: ((data: unknown) => void) | null = null
  const client = {
    subscribe: vi.fn((_m: string, _p: unknown, callback: (data: unknown) => void) => {
      onEvent = callback
      return vi.fn()
    }),
    getState: vi.fn(() => 'connected'),
    sendRequest: vi.fn(async (method: string, params: { lastSeenSeq?: number; epoch?: string }) => {
      if (method === 'notifications.getMissedSince') {
        const events = desk.buffer.filter(
          (e) => typeof e !== 'object' || e === null || (e as { notificationEpoch?: string }).notificationEpoch === desk.epoch
        )
        const all = params.epoch !== undefined && params.epoch !== desk.epoch
        const seqOf = (e: unknown) =>
          typeof e === 'object' && e !== null ? ((e as { notificationSeq?: number }).notificationSeq ?? 0) : 0
        return {
          ok: true,
          result: {
            notifications: all ? events : events.filter((e, i, a) => {
              // A malformed entry rides along with the seq of the entry before it.
              const s = seqOf(e) || seqOf(a[i - 1]) + 0.5
              return s > (params.lastSeenSeq ?? 0)
            }),
            epoch: desk.epoch
          }
        }
      }
      if (method === 'terminal.list') {
        return { ok: true, result: { terminals: [{ handle: 'term-1', agentIdentity: 'claude' }] } }
      }
      if (method === 'terminal.agentStatus') {
        return { ok: true, result: { agentStatus: { state: 'done' } } }
      }
      return { ok: true, result: {} }
    })
  } as unknown as RpcClient
  subscribeToDesktopNotifications(client, 'host-1')
  const ready = (id = 'sub-1') => onEvent!({ type: 'ready', subscriptionId: id, epoch: desk.epoch })
  ready()
  return {
    emit: (d) => onEvent!(d),
    ready,
    asked: () =>
      vi
        .mocked(client.sendRequest)
        .mock.calls.filter((c) => c[0] === 'notifications.getMissedSince')
        .map((c) => (c[1] as { lastSeenSeq: number }).lastSeenSeq)
  }
}

function postedBodies(): string[] {
  return vi
    .mocked(Notifications.scheduleNotificationAsync)
    .mock.calls.map((call) => String(call[0]?.content?.body ?? ''))
}

/** A tray that behaves like Android's: one banner per identifier, dismiss removes it. */
function useRealTray(): Map<string, { body: string; notificationId?: string }> {
  const tray = new Map<string, { body: string; notificationId?: string }>()
  let n = 0
  vi.mocked(Notifications.scheduleNotificationAsync).mockImplementation(async (request: Notifications.NotificationRequestInput) => {
    const id = request.identifier ?? `rand-${(n += 1)}`
    const data = request.content.data as { notificationId?: string } | undefined
    tray.set(id, { body: String(request.content.body ?? ''), notificationId: data?.notificationId })
    return id
  })
  vi.mocked(Notifications.dismissNotificationAsync).mockImplementation(async (id: string) => {
    tray.delete(id)
  })
  vi.mocked(Notifications.getPresentedNotificationsAsync).mockImplementation(async () =>
    [...tray.entries()].map(([identifier, v]) => ({
      request: { identifier, content: { data: { hostId: 'host-1', notificationId: v.notificationId } } }
    })) as never
  )
  return tray
}

/** Make the show of the event with this body throw (once, or always). */
function failShowOf(body: string, times = 1): void {
  const inner = vi.mocked(Notifications.scheduleNotificationAsync).getMockImplementation()!
  let left = times
  vi.mocked(Notifications.scheduleNotificationAsync).mockImplementation(async (request: Notifications.NotificationRequestInput) => {
    if (request.content.body === body && left > 0) {
      left -= 1
      throw new Error('post failed')
    }
    return inner(request)
  })
}

describe('draining a replay through a real tray', () => {
  beforeEach(() => {
    run += 1
    vi.clearAllMocks()
    storage.clear()
    clearLiveHostClientsForTest()
    resetHostNotificationSessionsForTests()
    vi.mocked(loadPushNotificationsEnabled).mockResolvedValue(true)
    vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      status: 'granted',
      canAskAgain: true
    } as never)
    storage.set(WATERMARK_KEY, JSON.stringify({ seq: 5, epoch: 'epoch-1' }))
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── Fallback ──────────────────────────────────────────────────────────────

  it('the fallback never posts a word whose dismiss this batch already delivered', async () => {
    const tray = useRealTray()
    failShowOf('b: finished')
    // wt-a spoke, the desk acknowledged it, wt-b spoke (its post fails), wt-a spoke again.
    const desk: Desk = {
      epoch: 'epoch-1',
      buffer: [notif(6, 'wt-a', 'a: first'), dismiss(7, id(6)), notif(8, 'wt-b', 'b: finished'), notif(9, 'wt-a', 'a: second')]
    }
    connect(desk)
    await flush()
    expect(postedBodies()).not.toContain('a: first')
    void tray
  })

  it('...nor leaves it in the tray when the desktop restarts before the next catch-up', async () => {
    const tray = useRealTray()
    failShowOf('b: finished')
    const desk: Desk = {
      epoch: 'epoch-1',
      buffer: [notif(6, 'wt-a', 'a: first'), dismiss(7, id(6)), notif(8, 'wt-b', 'b: finished'), notif(9, 'wt-a', 'a: second')]
    }
    const host = connect(desk)
    await flush()
    desk.epoch = 'epoch-2'
    desk.buffer = []
    host.ready('sub-2')
    await flush()
    expect([...tray.values()].map((v) => v.body)).not.toContain('a: first')
  })

  // ── Ordering, hold, watermark ─────────────────────────────────────────────

  it('deferred silent words settle after their superseder: seen, watermark and hold end right', async () => {
    useRealTray()
    const desk: Desk = {
      epoch: 'epoch-1',
      buffer: [notif(6, 'wt-a', 'a: 1'), notif(7, 'wt-b', 'b: 1'), notif(8, 'wt-a', 'a: 2'), notif(9, 'wt-c', 'c: 1')]
    }
    const host = connect(desk)
    await flush()
    expect(postedBodies()).toEqual(['b: 1', 'a: 2', 'c: 1'])
    expect(persistedSeq()).toBe(9)
    // The same batch again (overlap): nothing re-posts; a live event after it persists its own seq.
    host.ready('sub-2')
    await flush()
    host.emit(notif(10, 'wt-d', 'd: live'))
    await flush()
    expect(postedBodies()).toEqual(['b: 1', 'a: 2', 'c: 1', 'd: live'])
    expect(persistedSeq()).toBe(10)
  })

  it('the hold keeps the persisted watermark below a waiting word until its superseder lands', async () => {
    useRealTray()
    let release!: () => void
    const inner = vi.mocked(Notifications.scheduleNotificationAsync).getMockImplementation()!
    vi.mocked(Notifications.scheduleNotificationAsync).mockImplementation(async (request: Notifications.NotificationRequestInput) => {
      if (request.content.body === 'a: 2') {
        await new Promise<void>((resolve) => {
          release = resolve
        })
      }
      return inner(request)
    })
    const desk: Desk = {
      epoch: 'epoch-1',
      buffer: [notif(6, 'wt-a', 'a: 1'), notif(7, 'wt-b', 'b: 1'), notif(8, 'wt-a', 'a: 2')]
    }
    const host = connect(desk)
    await flush()
    // 7 delivered, 8 in flight, 6 waiting: persisted must not pass 5.
    expect(persistedSeq()).toBe(5)
    // A live event queued behind the batch waits for it and cannot persist past the hold.
    host.emit(notif(10, 'wt-d', 'd: live'))
    await flush()
    expect(persistedSeq()).toBe(5)
    release()
    await flush()
    expect(postedBodies()).toEqual(['b: 1', 'a: 2', 'd: live'])
    expect(persistedSeq()).toBe(10)
  })

  it('an aborted batch clears its hold: the quarantine alone decides, and recovery lifts it', async () => {
    useRealTray()
    failShowOf('b: 1')
    const desk: Desk = {
      epoch: 'epoch-1',
      buffer: [notif(6, 'wt-a', 'a: 1'), notif(7, 'wt-b', 'b: 1'), notif(8, 'wt-a', 'a: 2')]
    }
    const host = connect(desk)
    await flush()
    // Fallback posted a: 1; contiguous point is 6.
    expect(postedBodies()).toEqual(['b: 1', 'a: 1'])
    expect(persistedSeq()).toBe(6)
    host.ready('sub-2')
    await flush()
    expect(host.asked()).toEqual([5, 6])
    expect(postedBodies()).toEqual(['b: 1', 'a: 1', 'b: 1', 'a: 2'])
    expect(persistedSeq()).toBe(8)
  })

  it('a desktop restart (epoch adoption) after an aborted batch leaves no hold behind', async () => {
    useRealTray()
    failShowOf('b: 1')
    const desk: Desk = {
      epoch: 'epoch-1',
      buffer: [notif(6, 'wt-a', 'a: 1'), notif(7, 'wt-b', 'b: 1'), notif(8, 'wt-a', 'a: 2')]
    }
    const host = connect(desk)
    await flush()
    desk.epoch = 'epoch-2'
    desk.buffer = [notif(1, 'wt-x', 'x: 1', 'epoch-2'), notif(2, 'wt-x', 'x: 2', 'epoch-2')]
    host.ready('sub-2')
    await flush()
    host.emit(notif(3, 'wt-y', 'y: live', 'epoch-2'))
    await flush()
    expect(postedBodies().slice(-2)).toEqual(['x: 2', 'y: live'])
    expect(persistedSeq()).toBe(3)
  })

  // ── Dismiss / retire with waiting words ───────────────────────────────────

  it('dismiss of a waiting word before its superseder, and retire of the superseder, in one batch', async () => {
    const tray = useRealTray()
    tray.set('codeui:host-1:wt-d1', { body: 'a: from previous run', notificationId: id(4) })
    const desk: Desk = {
      epoch: 'epoch-1',
      buffer: [
        notif(6, 'wt-d1', 'a: 1'),
        dismiss(7, id(6)),
        notif(8, 'wt-d1b', 'b: 1'),
        notif(9, 'wt-d1', 'a: 2'),
        dismiss(10, id(9))
      ]
    }
    connect(desk)
    await flush()
    expect(postedBodies()).toEqual(['b: 1'])
    expect([...tray.values()].map((v) => v.body)).toEqual(['b: 1'])
    expect(persistedSeq()).toBe(10)
  })

  // ── Malformed ─────────────────────────────────────────────────────────────
})
