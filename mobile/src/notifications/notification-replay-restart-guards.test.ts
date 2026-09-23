import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Notifications from 'expo-notifications'
import type { RpcClient } from '../transport/rpc-client'
import { clearLiveHostClientsForTest } from '../transport/live-host-clients'
import { loadPushNotificationsEnabled } from '../storage/preferences'
import { subscribeToDesktopNotifications } from './mobile-notifications'
import { resetHostNotificationSessionsForTests } from './notification-reconnect-catchup'

// The stored seen keys and the deferred silent word, across a restart, a slow
// store, a desktop restart and a replay that breaks off. The first three of
// these were red on 2fa3399b: a late seen read evicted the newest keys, so a
// restart re-posted one, and a silenced word counted as delivered before the
// word superseding it had landed, so a failed show plus a desktop restart lost
// the session's word outright.
const appState = vi.hoisted(() => ({ current: 'background' as string }))
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
  AppState: {
    get currentState() {
      return appState.current
    },
    addEventListener: vi.fn()
  },
  Platform: { OS: 'android', Version: 34 }
}))
const WATERMARK_KEY = 'orca:mobileNotificationsWatermark:host-1'
const SEEN_KEY = 'orca:mobileNotificationsSeen:host-1'
const storage = new Map<string, string>()
/** Per-key read delay (ms) and write failure, for the seed and lag cases. */
const readDelay = new Map<string, number>()
const failWrites = new Set<string>()
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => {
      // Read at submission, answered late: AsyncStorage runs operations in order.
      const value = storage.get(key) ?? null
      const delay = readDelay.get(key)
      if (delay) {
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
      return value
    }),
    setItem: vi.fn(async (key: string, value: string) => {
      if (failWrites.has(key)) {
        throw new Error('write failed')
      }
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
  for (let i = 0; i < 60; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function persistedSeq(): number {
  return (JSON.parse(storage.get(WATERMARK_KEY) ?? '{}') as { seq?: number }).seq ?? 0
}
function persistedSeen(): { epoch?: string; keys?: string[] } {
  return JSON.parse(storage.get(SEEN_KEY) ?? '{}') as { epoch?: string; keys?: string[] }
}

function notif(seq: number, worktreeId: string, body = `event ${seq}`, epoch = 'epoch-1', id = `agent:${seq}`) {
  return {
    type: 'notification',
    source: 'agent-task-complete',
    title: `NexOS / ${worktreeId} - Claude finished`,
    body,
    worktreeId,
    notificationId: id,
    notificationSeq: seq,
    notificationEpoch: epoch
  }
}
function bell(seq: number, worktreeId: string, epoch = 'epoch-1') {
  return {
    type: 'notification',
    source: 'terminal-bell',
    title: `NexOS / ${worktreeId} - Terminal bell`,
    body: 'bell',
    worktreeId,
    notificationSeq: seq,
    notificationEpoch: epoch
  }
}
function dismiss(seq: number, notificationId: string, epoch = 'epoch-1') {
  return { type: 'dismiss', notificationId, notificationSeq: seq, notificationEpoch: epoch }
}

type Desk = {
  epoch: string
  /** Everything the desktop buffer holds, per epoch. */
  buffer: unknown[]
  missedFails: boolean
}

type Host = {
  emit: (data: unknown) => void
  unsubscribe: () => void
  ready: (id?: string) => void
  asked: () => number[]
}

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
        if (desk.missedFails) {
          return { ok: false, error: { code: 'x', message: 'down' } }
        }
        const events = desk.buffer.filter(
          (e) => (e as { notificationEpoch: string }).notificationEpoch === desk.epoch
        )
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
  const unsubscribe = subscribeToDesktopNotifications(client, 'host-1')
  const ready = (id = 'sub-1') => onEvent!({ type: 'ready', subscriptionId: id, epoch: desk.epoch })
  ready()
  return {
    emit: (data) => onEvent!(data),
    unsubscribe,
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
  vi.mocked(Notifications.dismissNotificationAsync).mockClear()
}

function postedBodies(): string[] {
  return vi
    .mocked(Notifications.scheduleNotificationAsync)
    .mock.calls.map((call) => String(call[0]?.content?.body ?? ''))
}

describe('a replay across a restart', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storage.clear()
    readDelay.clear()
    failWrites.clear()
    appState.current = 'background'
    clearLiveHostClientsForTest()
    resetHostNotificationSessionsForTests()
    vi.mocked(loadPushNotificationsEnabled).mockResolvedValue(true)
    vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      status: 'granted',
      canAskAgain: true
    } as never)
    vi.mocked(Notifications.scheduleNotificationAsync).mockImplementation(
      async (request: { identifier?: string }) => request.identifier ?? `rand-${Math.random()}`
    )
    vi.mocked(Notifications.getPresentedNotificationsAsync).mockImplementation(async () => [])
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── Persisted seen keys ────────────────────────────────────────────────────

  it('a late seen read keeps the newest shown key when it merges with live ones', async () => {
    // The previous run's 256 keys are on disk; this run's seen read outlasts the
    // 3 s seed timeout, so the catch-up and a live event land before it merges.
    storage.set(WATERMARK_KEY, JSON.stringify({ seq: 300, epoch: 'epoch-1' }))
    storage.set(
      SEEN_KEY,
      JSON.stringify({
        epoch: 'epoch-1',
        keys: Array.from({ length: 256 }, (_, i) => `id:agent:${i + 1}#${i + 1}`)
      })
    )
    readDelay.set(SEEN_KEY, 3300)
    const desk: Desk = { epoch: 'epoch-1', buffer: [notif(301, 'wt-a', 'a: missed')], missedFails: false }
    const host = connect(desk)
    await new Promise((resolve) => setTimeout(resolve, 3100))
    await flush()
    expect(postedBodies()).toEqual(['a: missed'])
    // The late read lands and merges the stored keys.
    await new Promise((resolve) => setTimeout(resolve, 400))
    await flush()
    host.emit(notif(302, 'wt-b', 'b: live'))
    await flush()
    // The two newest deliveries are the ones a lagging restart would replay.
    expect(persistedSeen().keys).toEqual(expect.arrayContaining(['id:agent:301#301', 'id:agent:302#302']))
  }, 10_000)

  it('...and so a restart from a lagging watermark re-posts the one it dropped', async () => {
    storage.set(WATERMARK_KEY, JSON.stringify({ seq: 300, epoch: 'epoch-1' }))
    storage.set(
      SEEN_KEY,
      JSON.stringify({
        epoch: 'epoch-1',
        keys: Array.from({ length: 256 }, (_, i) => `id:agent:${i + 1}#${i + 1}`)
      })
    )
    readDelay.set(SEEN_KEY, 3300)
    // Every watermark write of this run is lost (fire-and-forget, the lag the store exists for).
    failWrites.add(WATERMARK_KEY)
    const desk: Desk = { epoch: 'epoch-1', buffer: [notif(301, 'wt-a', 'a: missed')], missedFails: false }
    const host = connect(desk)
    await new Promise((resolve) => setTimeout(resolve, 3100))
    await flush()
    await new Promise((resolve) => setTimeout(resolve, 400))
    await flush()
    desk.buffer.push(notif(302, 'wt-b', 'b: live'))
    host.emit(notif(302, 'wt-b', 'b: live'))
    await flush()
    expect(persistedSeq()).toBe(300)
    killProcess()
    readDelay.clear()
    failWrites.clear()
    connect(desk)
    await flush()
    // Both were shown by the previous run: nothing should post again.
    expect(postedBodies()).toEqual([])
  }, 10_000)

  it('desktop restart between runs: a stored key from the old lifetime never hides the new counter\'s event', async () => {
    // Run 1, lifetime epoch-1: a bell at seq 2 is shown (key seq:2).
    const desk: Desk = { epoch: 'epoch-1', buffer: [], missedFails: false }
    storage.set(WATERMARK_KEY, JSON.stringify({ seq: 1, epoch: 'epoch-1' }))
    const first = connect(desk)
    await flush()
    first.emit(bell(2, 'wt-a'))
    await flush()
    expect(persistedSeen().keys).toContain('seq:2')
    killProcess()
    // The desktop restarts: epoch-2, whose seq 2 is a different bell.
    desk.epoch = 'epoch-2'
    desk.buffer = [bell(1, 'wt-b', 'epoch-2'), bell(2, 'wt-c', 'epoch-2')]
    // And the seen read is slow, so it lands after the epoch was adopted.
    readDelay.set(SEEN_KEY, 3300)
    const second = connect(desk)
    await new Promise((resolve) => setTimeout(resolve, 3100))
    await flush()
    expect(postedBodies()).toHaveLength(2)
    await new Promise((resolve) => setTimeout(resolve, 400))
    await flush()
    // A reconnect serving the same new-lifetime seq must not be judged by epoch-1 keys.
    killProcess()
    readDelay.clear()
    storage.set(WATERMARK_KEY, JSON.stringify({ seq: 0, epoch: 'epoch-2' }))
    connect(desk)
    await flush()
    expect(persistedSeen().epoch).toBe('epoch-2')
    void second
  }, 12_000)

  it('the same notificationId at a new seq after a restart still posts', async () => {
    const desk: Desk = { epoch: 'epoch-1', buffer: [], missedFails: false }
    storage.set(WATERMARK_KEY, JSON.stringify({ seq: 5, epoch: 'epoch-1' }))
    const first = connect(desk)
    await flush()
    const shown = notif(6, 'wt-a', 'a: first', 'epoch-1', 'agent:x')
    desk.buffer.push(shown)
    first.emit(shown)
    await flush()
    killProcess()
    // Lagging watermark; the same id comes back at seq 8 with new content.
    storage.set(WATERMARK_KEY, JSON.stringify({ seq: 5, epoch: 'epoch-1' }))
    desk.buffer.push(notif(8, 'wt-a', 'a: refreshed', 'epoch-1', 'agent:x'))
    connect(desk)
    await flush()
    expect(postedBodies()).toEqual(['a: refreshed'])
  })

  // ── Seen-skip watermark advance vs #8591 quarantine ────────────────────────

  it('seen-skips before a failing show quarantine at the last delivered seq, and the gap is recovered', async () => {
    const desk: Desk = { epoch: 'epoch-1', buffer: [], missedFails: true }
    storage.set(WATERMARK_KEY, JSON.stringify({ seq: 5, epoch: 'epoch-1' }))
    const first = connect(desk)
    await flush()
    // The catch-up failed, so the persisted watermark is clamped at 5 while live 6, 7 show.
    for (const e of [notif(6, 'wt-a', 'a: live'), notif(7, 'wt-b', 'b: live')]) {
      desk.buffer.push(e)
      first.emit(e)
    }
    await flush()
    expect(persistedSeq()).toBe(5)
    killProcess()
    desk.missedFails = false
    desk.buffer.push(notif(8, 'wt-c', 'c: missed'))
    let failOnce = true
    vi.mocked(Notifications.scheduleNotificationAsync).mockImplementation(async (request: { identifier?: string }) => {
      if (failOnce) {
        failOnce = false
        throw new Error('post failed')
      }
      return request.identifier ?? 'rand'
    })
    const second = connect(desk)
    await flush()
    expect(persistedSeq()).toBe(7)
    second.ready('sub-2')
    await flush()
    expect(second.asked()).toEqual([5, 7])
    expect(postedBodies()).toEqual(['c: missed', 'c: missed'])
    expect(persistedSeq()).toBe(8)
  })

  it('a word silenced by the one after it is not lost when that one fails and the desktop restarts', async () => {
    const desk: Desk = {
      epoch: 'epoch-1',
      buffer: [notif(6, 'wt-a', 'a: first'), notif(7, 'wt-a', 'a: second')],
      missedFails: false
    }
    storage.set(WATERMARK_KEY, JSON.stringify({ seq: 5, epoch: 'epoch-1' }))
    vi.mocked(Notifications.scheduleNotificationAsync).mockImplementation(async () => {
      throw new Error('post failed')
    })
    const host = connect(desk)
    await flush()
    // The desktop restarts before the next catch-up: its buffer is gone.
    vi.mocked(Notifications.scheduleNotificationAsync).mockImplementation(
      async (request: { identifier?: string }) => request.identifier ?? 'rand'
    )
    desk.epoch = 'epoch-2'
    desk.buffer = []
    host.ready('sub-2')
    await flush()
    const attempted = vi
      .mocked(Notifications.scheduleNotificationAsync)
      .mock.calls.map((call) => String(call[0]?.content?.body ?? ''))
    // Something for wt-a must have been attempted besides the failing 'second'.
    expect(attempted).toContain('a: first')
  })

  // ── Retire ────────────────────────────────────────────────────────────────

  it('retire with the app open matches what live delivery leaves in the tray', async () => {
    appState.current = 'active'
    vi.mocked(Notifications.getPresentedNotificationsAsync).mockResolvedValue([
      {
        request: {
          identifier: 'codeui:host-1:wt-a',
          content: { data: { hostId: 'host-1', notificationId: 'agent:4' } }
        }
      }
    ] as never)
    const desk: Desk = {
      epoch: 'epoch-1',
      buffer: [notif(6, 'wt-a', 'a: other pane'), dismiss(7, 'agent:6')],
      missedFails: false
    }
    storage.set(WATERMARK_KEY, JSON.stringify({ seq: 5, epoch: 'epoch-1' }))
    connect(desk)
    await flush()
    const replayDismissed = vi.mocked(Notifications.dismissNotificationAsync).mock.calls.map((c) => c[0])
    // Same events live, fresh process, same tray.
    killProcess()
    storage.clear()
    const live = connect({ epoch: 'epoch-1', buffer: [], missedFails: false })
    await flush()
    live.emit(notif(6, 'wt-a', 'a: other pane'))
    await flush()
    live.emit(dismiss(7, 'agent:6'))
    await flush()
    const liveDismissed = vi.mocked(Notifications.dismissNotificationAsync).mock.calls.map((c) => c[0])
    expect(replayDismissed).toContain('codeui:host-1:wt-a')
    expect(liveDismissed).toContain('codeui:host-1:wt-a')
  })

  it('retire never touches an id-less banner of the same worktree', async () => {
    const desk: Desk = {
      epoch: 'epoch-1',
      buffer: [notif(6, 'wt-a', 'a: done'), bell(7, 'wt-a'), dismiss(8, 'agent:6')],
      missedFails: false
    }
    storage.set(WATERMARK_KEY, JSON.stringify({ seq: 5, epoch: 'epoch-1' }))
    connect(desk)
    await flush()
    expect(postedBodies()).toEqual(['bell'])
    const dismissed = vi.mocked(Notifications.dismissNotificationAsync).mock.calls.map((c) => c[0])
    expect(dismissed).toEqual(['codeui:host-1:wt-a'])
  })

  // ── Store writes ──────────────────────────────────────────────────────────
})
