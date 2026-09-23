import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Notifications from 'expo-notifications'
import type { RpcClient } from '../transport/rpc-client'
import { clearLiveHostClientsForTest } from '../transport/live-host-clients'
import { loadPushNotificationsEnabled } from '../storage/preferences'
import { subscribeToDesktopNotifications } from './mobile-notifications'
import { resetHostNotificationSessionsForTests } from './notification-reconnect-catchup'

// A replayed word whose dismiss is later in the same batch is resolved: it settles
// at once and never posts, however the batch ends. Three of these were red on
// 8661544f, whose failure fallback could post such a word. The process-death
// cases restart through vi.resetModules, so module state really dies.
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

let run = 0
const id = (seq: number) => `agent:r${run}:${seq}`
const wt = (name: string) => `${name}-r${run}`

async function flush(): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}
function persistedSeq(): number {
  return (JSON.parse(storage.get(WATERMARK_KEY) ?? '{}') as { seq?: number }).seq ?? 0
}
function notif(seq: number, worktree: string, body: string) {
  return {
    type: 'notification',
    source: 'agent-task-complete',
    title: `NexOS / ${worktree} - Claude finished`,
    body,
    worktreeId: wt(worktree),
    notificationId: id(seq),
    notificationSeq: seq,
    notificationEpoch: 'epoch-1'
  }
}
function dismiss(seq: number, of: number) {
  return { type: 'dismiss', notificationId: id(of), notificationSeq: seq, notificationEpoch: 'epoch-1' }
}

type Desk = { epoch: string; buffer: unknown[] }
function connect(desk: Desk, subscribe = subscribeToDesktopNotifications) {
  let onEvent: ((data: unknown) => void) | null = null
  const client = {
    subscribe: vi.fn((_m: string, _p: unknown, callback: (data: unknown) => void) => {
      onEvent = callback
      return vi.fn()
    }),
    getState: vi.fn(() => 'connected'),
    sendRequest: vi.fn(async (method: string, params: { lastSeenSeq?: number; epoch?: string }) => {
      if (method === 'notifications.getMissedSince') {
        const events = desk.buffer.filter((e) => (e as { notificationEpoch: string }).notificationEpoch === desk.epoch)
        const all = params.epoch !== undefined && params.epoch !== desk.epoch
        return {
          ok: true,
          result: {
            notifications: all
              ? events
              : events.filter((e) => (e as { notificationSeq: number }).notificationSeq > (params.lastSeenSeq ?? 0)),
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
  subscribe(client, 'host-1')
  const ready = (sub = 'sub-1') => onEvent!({ type: 'ready', subscriptionId: sub, epoch: desk.epoch })
  ready()
  return {
    ready,
    asked: () =>
      vi
        .mocked(client.sendRequest)
        .mock.calls.filter((c) => c[0] === 'notifications.getMissedSince')
        .map((c) => (c[1] as { lastSeenSeq: number }).lastSeenSeq)
  }
}
function killProcess(): void {
  resetHostNotificationSessionsForTests()
  vi.mocked(Notifications.scheduleNotificationAsync).mockClear()
}
function attempted(N: typeof Notifications = Notifications): string[] {
  return vi.mocked(N.scheduleNotificationAsync).mock.calls.map((c) => String(c[0]?.content?.body ?? ''))
}

/** Android-like tray: one banner per identifier. `fail` bodies throw; `hang` bodies never return. */
function useTray(opts: { fail?: Map<string, number>; hang?: Set<string> } = {}, N: typeof Notifications = Notifications) {
  const tray = new Map<string, string>()
  let n = 0
  vi.mocked(N.scheduleNotificationAsync).mockImplementation(async (request: Notifications.NotificationRequestInput) => {
    const body = String(request.content.body ?? '')
    const left = opts.fail?.get(body) ?? 0
    if (left > 0) {
      opts.fail!.set(body, left - 1)
      throw new Error('post failed')
    }
    if (opts.hang?.has(body)) {
      return new Promise<string>(() => {})
    }
    const key = request.identifier ?? `rand-${(n += 1)}`
    tray.set(key, body)
    return key
  })
  vi.mocked(N.dismissNotificationAsync).mockImplementation(async (key: string) => {
    tray.delete(key)
  })
  return tray
}

/** A real process death: every module's memory goes, storage stays. The imports are inline on
 *  purpose: only an import made after vi.resetModules returns a fresh module instance. */
async function freshProcess() {
  vi.resetModules()
  const N = await import('expo-notifications')
  const prefs = await import('../storage/preferences')
  vi.mocked(prefs.loadPushNotificationsEnabled).mockResolvedValue(true)
  vi.mocked(N.getPermissionsAsync).mockResolvedValue({ status: 'granted', canAskAgain: true } as never)
  vi.mocked(N.getPresentedNotificationsAsync).mockImplementation(async () => [])
  // The mocked module outlives resetModules; forget the previous process's calls.
  vi.mocked(N.scheduleNotificationAsync).mockClear()
  vi.mocked(N.dismissNotificationAsync).mockClear()
  const M = await import('./mobile-notifications')
  return { N: N as typeof Notifications, subscribe: M.subscribeToDesktopNotifications }
}

describe('a replayed word the desk dismissed', () => {
  beforeEach(() => {
    run += 1
    vi.clearAllMocks()
    storage.clear()
    clearLiveHostClientsForTest()
    resetHostNotificationSessionsForTests()
    vi.mocked(loadPushNotificationsEnabled).mockResolvedValue(true)
    vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ status: 'granted', canAskAgain: true } as never)
    vi.mocked(Notifications.getPresentedNotificationsAsync).mockImplementation(async () => [])
    storage.set(WATERMARK_KEY, JSON.stringify({ seq: 5, epoch: 'epoch-1' }))
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('the fallback skips a resolved word and falls back to the unresolved one before it', async () => {
    const tray = useTray({ fail: new Map([['b: 1', 1]]) })
    const desk: Desk = {
      epoch: 'epoch-1',
      buffer: [notif(6, 'a', 'a: 1'), notif(7, 'a', 'a: 2'), notif(8, 'b', 'b: 1'), dismiss(9, 7), notif(10, 'a', 'a: 3')]
    }
    const host = connect(desk)
    await flush()
    expect(attempted()).toEqual(['b: 1', 'a: 1'])
    host.ready('sub-2')
    await flush()
    expect(attempted()).not.toContain('a: 2')
    expect([...tray.values()].sort()).toEqual(['a: 3', 'b: 1'])
    expect(persistedSeq()).toBe(10)
  })

  it('abort after a resolved word but before its dismiss, then a desktop restart: never posted', async () => {
    const tray = useTray({ fail: new Map([['b: 1', 99]]) })
    const desk: Desk = {
      epoch: 'epoch-1',
      buffer: [notif(6, 'a', 'a: 1'), notif(7, 'b', 'b: 1'), notif(8, 'a', 'a: 2'), dismiss(9, 6), dismiss(10, 8)]
    }
    const host = connect(desk)
    await flush()
    desk.epoch = 'epoch-2'
    desk.buffer = []
    host.ready('sub-2')
    await flush()
    expect(attempted().filter((b) => b.startsWith('a:'))).toEqual([])
    expect([...tray.values()]).toEqual([])
  })

  it('the resolved word is re-fetched after a restart with no seen record: still never posted', async () => {
    // The fallback's own show fails too, so the contiguous point stays below the resolved word.
    const tray = useTray({ fail: new Map([['c: 1', 1], ['a: 1', 1]]) })
    const desk: Desk = {
      epoch: 'epoch-1',
      buffer: [
        notif(6, 'a', 'a: 1'),
        notif(7, 'b', 'b: 1'),
        notif(8, 'b', 'b: 2'),
        dismiss(9, 7),
        notif(10, 'c', 'c: 1'),
        notif(11, 'a', 'a: 2'),
        notif(12, 'b', 'b: 3')
      ]
    }
    connect(desk)
    await flush()
    expect(persistedSeq()).toBe(5)
    killProcess()
    storage.delete(SEEN_KEY)
    connect(desk)
    await flush()
    expect(attempted()).not.toContain('b: 1')
    expect([...tray.values()].sort()).toEqual(['a: 2', 'b: 3', 'c: 1'])
    expect(persistedSeq()).toBe(12)
  })

  it('a resolved word settling early does not lift the hold of an earlier waiting word', async () => {
    const one = await freshProcess()
    useTray({ hang: new Set(['a: 3']) }, one.N)
    const desk: Desk = {
      epoch: 'epoch-1',
      buffer: [notif(6, 'a', 'a: 1'), notif(7, 'a', 'a: 2'), notif(8, 'b', 'b: 1'), dismiss(9, 7), notif(10, 'a', 'a: 3')]
    }
    connect(desk, one.subscribe)
    await flush()
    // 6 waits on 10 (in flight); 7 resolved and settled; 8, 9 delivered.
    expect(persistedSeq()).toBe(5)
    const two = await freshProcess()
    const tray = useTray({}, two.N)
    connect(desk, two.subscribe)
    await flush()
    // Replayed from 5: b: 1 again only if its seen key was not stored; a: 2 never.
    expect(attempted(two.N)).toContain('a: 3')
    expect(attempted(two.N)).not.toContain('a: 2')
    expect([...tray.values()].sort()).toEqual(expect.arrayContaining(['a: 3']))
    expect(persistedSeq()).toBe(10)
  })

  it('process death after a resolved word settles, no waiting word: restart neither loses news nor posts it', async () => {
    const one = await freshProcess()
    useTray({ hang: new Set(['b: 1']) }, one.N)
    const desk: Desk = {
      epoch: 'epoch-1',
      buffer: [notif(6, 'a', 'a: 1'), notif(7, 'b', 'b: 1'), notif(8, 'a', 'a: 2'), dismiss(9, 6)]
    }
    connect(desk, one.subscribe)
    await flush()
    // 6 resolved and settled (seen, watermark 6); 7 hangs.
    expect(persistedSeq()).toBe(6)
    const two = await freshProcess()
    const tray = useTray({}, two.N)
    connect(desk, two.subscribe)
    await flush()
    expect(attempted(two.N)).toEqual(['b: 1', 'a: 2'])
    expect([...tray.values()].sort()).toEqual(['a: 2', 'b: 1'])
    expect(persistedSeq()).toBe(9)
  })

  it('retire with resolved silent words before it clears the previous run banner and posts nothing', async () => {
    const tray = useTray()
    tray.set(`codeui:host-1:${wt('a')}`, 'a: from previous run')
    const desk: Desk = {
      epoch: 'epoch-1',
      buffer: [notif(6, 'a', 'a: 1'), notif(7, 'a', 'a: 2'), dismiss(8, 6), dismiss(9, 7)]
    }
    connect(desk)
    await flush()
    expect(attempted()).toEqual([])
    expect([...tray.values()]).toEqual([])
    expect(persistedSeq()).toBe(9)
  })

  it('resolved and waiting words for the same superseder: the waiting one settles when it lands', async () => {
    const tray = useTray()
    const desk: Desk = {
      epoch: 'epoch-1',
      buffer: [notif(6, 'a', 'a: 1'), notif(7, 'a', 'a: 2'), dismiss(8, 7), notif(9, 'b', 'b: 1'), notif(10, 'a', 'a: 3')]
    }
    const host = connect(desk)
    await flush()
    expect(attempted()).toEqual(['b: 1', 'a: 3'])
    expect([...tray.values()].sort()).toEqual(['a: 3', 'b: 1'])
    expect(persistedSeq()).toBe(10)
    host.ready('sub-2')
    await flush()
    expect(attempted()).toEqual(['b: 1', 'a: 3'])
  })
})
