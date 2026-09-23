import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Notifications from 'expo-notifications'
import type { RpcClient } from '../transport/rpc-client'
import { clearLiveHostClientsForTest } from '../transport/live-host-clients'
import { loadPushNotificationsEnabled } from '../storage/preferences'
import { subscribeToDesktopNotifications } from './mobile-notifications'
import { resetHostNotificationSessionsForTests } from './notification-reconnect-catchup'

// A replay may skip a banner only when the banner would not have been news: a
// notification dismissed later in the same batch, or a word its own banner
// replaces before anyone could read it. These cases pin the other side — every
// shape where a skipped replay would LOSE a banner the user needed. Each was red
// on the first cut of the replay plan (915558c0), which aged events out after 10
// minutes and treated a bell or a plugin as a session's word.
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

let run = 0
const id = (seq: number) => `agent:r${run}:${seq}`
const NOW = Date.parse('2026-09-23T14:00:00Z')
const MINUTE = 60_000

async function flush(): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function persistedSeq(): number {
  return (JSON.parse(storage.get(WATERMARK_KEY) ?? '{}') as { seq?: number }).seq ?? 0
}

function agentDone(seq: number, worktreeId: string, minutesAgo: number, body = `event ${seq}`) {
  return {
    type: 'notification',
    source: 'agent-task-complete',
    title: `NexOS / ${worktreeId} - Claude finished`,
    body,
    worktreeId,
    notificationId: id(seq),
    notificationSeq: seq,
    notificationEpoch: 'epoch-1',
    emittedAt: NOW - minutesAgo * MINUTE
  }
}

// Stock Orca: a terminal bell carries worktreeId and emittedAt but no notificationId
// (use-notification-dispatch.ts mints one only for agent-task-complete).
function bell(seq: number, worktreeId: string, minutesAgo: number) {
  return {
    type: 'notification',
    source: 'terminal-bell',
    title: `NexOS / ${worktreeId} - Terminal bell`,
    body: 'bell',
    worktreeId,
    notificationSeq: seq,
    notificationEpoch: 'epoch-1',
    emittedAt: NOW - minutesAgo * MINUTE
  }
}

// Stock Orca dispatchPlugin: no worktreeId, no notificationId, no emittedAt.
function plugin(seq: number, pluginId: string, title: string) {
  return {
    type: 'notification',
    source: 'plugin',
    title: `${pluginId}: ${title}`,
    body: `${pluginId} body`,
    notificationSeq: seq,
    notificationEpoch: 'epoch-1'
  }
}

function dismiss(seq: number, notificationId: string) {
  return { type: 'dismiss', notificationId, notificationSeq: seq, notificationEpoch: 'epoch-1' }
}

type AgentNow = { state: string; interactivePrompt?: string }

type Host = {
  client: RpcClient
  emit: (data: unknown) => void
  setMissed: (fn: (lastSeenSeq: number) => unknown[]) => void
  terminalListOk: boolean
  gate: { missed: Promise<void> | null }
}

function makeHost(agentNow: AgentNow = { state: 'done' }): Host {
  let onEvent: ((data: unknown) => void) | null = null
  let missedFor: (lastSeenSeq: number) => unknown[] = () => []
  const host: Host = {
    client: null as unknown as RpcClient,
    emit: (data) => onEvent!(data),
    setMissed: (fn) => {
      missedFor = fn
    },
    terminalListOk: true,
    gate: { missed: null }
  }
  host.client = {
    subscribe: vi.fn((_method: string, _params: unknown, callback: (data: unknown) => void) => {
      onEvent = callback
      return vi.fn()
    }),
    getState: vi.fn(() => 'connected'),
    sendRequest: vi.fn(async (method: string, params: { lastSeenSeq?: number }) => {
      if (method === 'notifications.getMissedSince') {
        if (host.gate.missed) {
          await host.gate.missed
        }
        return {
          ok: true,
          result: { notifications: missedFor(params.lastSeenSeq ?? 0), epoch: 'epoch-1' }
        }
      }
      if (method === 'terminal.list') {
        if (!host.terminalListOk) {
          return { ok: false, error: { code: 'internal', message: 'refused' } }
        }
        return { ok: true, result: { terminals: [{ handle: 'term-1', agentIdentity: 'claude' }] } }
      }
      if (method === 'terminal.agentStatus') {
        return { ok: true, result: { agentStatus: agentNow } }
      }
      return { ok: true, result: {} }
    })
  } as unknown as RpcClient
  return host
}

function start(host: Host, watermark = 5): void {
  storage.set(WATERMARK_KEY, JSON.stringify({ seq: watermark, epoch: 'epoch-1' }))
  subscribeToDesktopNotifications(host.client, 'host-1')
  host.emit({ type: 'ready', subscriptionId: 'sub-1', epoch: 'epoch-1' })
}

function postedTitles(): string[] {
  return vi
    .mocked(Notifications.scheduleNotificationAsync)
    .mock.calls.map((call) => String(call[0]?.content?.title ?? ''))
}

function postedBodies(): string[] {
  return vi
    .mocked(Notifications.scheduleNotificationAsync)
    .mock.calls.map((call) => String(call[0]?.content?.body ?? ''))
}

describe('a replay never drops a banner the user needs', () => {
  beforeEach(() => {
    run += 1
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
    // Expo returns the identifier it was asked to post under, or a fresh one.
    vi.mocked(Notifications.scheduleNotificationAsync).mockImplementation(
      async (request: { identifier?: string }) => request.identifier ?? 'scheduled-1'
    )
    vi.mocked(Notifications.getPresentedNotificationsAsync).mockImplementation(async () => [])
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps the "Claude finished" banner when a terminal bell in the same worktree follows it', async () => {
    const host = makeHost()
    host.setMissed(() => [agentDone(6, 'wt-x', 2, 'x: finished'), bell(7, 'wt-x', 2)])
    start(host)
    await flush()
    // The bell has no notificationId, so it never shares the session identifier
    // live: the two are separate banners. The finished one must still post.
    expect(postedBodies()).toContain('x: finished')
  })

  it('posts both plugin notifications of one replay (no worktree, no id: separate banners)', async () => {
    const host = makeHost()
    host.setMissed(() => [plugin(6, 'ci', 'build failed'), plugin(7, 'deploy', 'done')])
    start(host)
    await flush()
    expect(postedTitles().length).toBe(2)
  })

  it('posts a just-emitted notification when the desktop clock runs 12 min behind the phone', async () => {
    const host = makeHost()
    // Emitted "now" by the desktop's clock, which is 12 min slow against the phone.
    host.setMissed(() => [agentDone(6, 'wt-x', 12, 'x: finished just now')])
    start(host)
    await flush()
    expect(postedBodies()).toEqual(['x: finished just now'])
  })

  it('Doze: a finished the desk never acknowledged, caught up 45 min later in the background', async () => {
    const host = makeHost()
    // Background watcher, phone in Doze: the socket went silent, the maintenance
    // window reconnects, catch-up is the only delivery. No dismiss in the batch:
    // the desk never acknowledged the pane (ui-slice-activity-actions would have).
    host.setMissed(() => [agentDone(6, 'wt-x', 45, 'x: finished')])
    start(host)
    await flush()
    expect(postedBodies()).toEqual(['x: finished'])
  })

  it('a stale ask still pops when the prompt lookup cannot answer (fail-open)', async () => {
    const host = makeHost({
      state: 'waiting',
      interactivePrompt: JSON.stringify({ approval: { tool: 'Bash', summary: 'pnpm test' } })
    })
    host.terminalListOk = false
    host.setMissed(() => [agentDone(6, 'wt-x', 30, 'x: needs permission')])
    start(host)
    await flush()
    // decorateWithPrompt's contract: a failed lookup keeps the desktop's own banner.
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1)
  })

  it('a silent replay releases its dedup claim: a live re-dispatch of the same id still posts', async () => {
    const host = makeHost()
    host.setMissed(() => [agentDone(6, 'wt-x', 2, 'x: first'), agentDone(7, 'wt-x', 1, 'x: second')])
    start(host)
    await flush()
    expect(postedBodies()).toEqual(['x: second'])
    host.emit({ ...agentDone(6, 'wt-x', 0, 'x: first again'), notificationSeq: 8 })
    await flush()
    expect(postedBodies()).toEqual(['x: second', 'x: first again'])
    expect(persistedSeq()).toBe(8)
  })

  it('a failed show after a silent one quarantines at the silent seq, and the next catch-up posts it', async () => {
    const host = makeHost()
    const all = [agentDone(6, 'wt-x', 2, 'x: first'), agentDone(7, 'wt-x', 1, 'x: second')]
    host.setMissed((lastSeen) => all.filter((e) => e.notificationSeq > lastSeen))
    let failOnce = true
    vi.mocked(Notifications.scheduleNotificationAsync).mockImplementation(async () => {
      if (failOnce) {
        failOnce = false
        throw new Error('post failed')
      }
      return 'codeui:host-1:wt-x'
    })
    start(host)
    await flush()
    expect(persistedSeq()).toBe(6)
    // Reconnect.
    host.emit({ type: 'ready', subscriptionId: 'sub-2', epoch: 'epoch-1' })
    await flush()
    const asked = vi
      .mocked(host.client.sendRequest)
      .mock.calls.filter((c) => c[0] === 'notifications.getMissedSince')
      .map((c) => (c[1] as { lastSeenSeq: number }).lastSeenSeq)
    expect(asked).toEqual([5, 6])
    expect(postedBodies()).toEqual(['x: second', 'x: second'])
    expect(persistedSeq()).toBe(7)
  })

  it('a live event is never planned: an hour-old emittedAt still posts live', async () => {
    const host = makeHost()
    host.setMissed(() => [])
    start(host)
    await flush()
    host.emit(agentDone(9, 'wt-x', 60, 'x: live but old stamp'))
    await flush()
    expect(postedBodies()).toEqual(['x: live but old stamp'])
  })


  it('clears the tray banner a previous run left for the session when its replayed word is dismissed', async () => {
    vi.mocked(Notifications.getPresentedNotificationsAsync).mockResolvedValue([
      {
        request: {
          identifier: 'codeui:host-1:wt-tray',
          content: { data: { hostId: 'host-1', notificationId: id(4) } }
        }
      }
    ] as never)
    const host = makeHost()
    host.setMissed(() => [agentDone(6, 'wt-tray', 2, 'tray: newer'), dismiss(7, id(6))])
    start(host)
    await flush()
    // wt-tray, not wt-x: earlier cases here posted on wt-x in this same process,
    // and a banner this process posted is not the replay's to retire.
    expect(vi.mocked(Notifications.dismissNotificationAsync).mock.calls.map((c) => c[0])).toContain(
      'codeui:host-1:wt-tray'
    )
  })

  it('a stale ask the agent is paused on pops even with the app backgrounded and superseded words before it', async () => {
    const host = makeHost({
      state: 'waiting',
      interactivePrompt: JSON.stringify({ approval: { tool: 'Bash', summary: 'pnpm test' } })
    })
    host.setMissed(() => [agentDone(6, 'wt-x', 40), agentDone(7, 'wt-x', 30)])
    start(host)
    await flush()
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1)
    expect(persistedSeq()).toBe(7)
  })

  it('degenerate: a batch that is only a dismiss, and a notification whose id reappears after its dismiss', async () => {
    const host = makeHost()
    host.setMissed(() => [
      agentDone(6, 'wt-x', 2, 'x: first'),
      dismiss(7, id(6)),
      { ...agentDone(6, 'wt-x', 1, 'x: re-announced'), notificationSeq: 8 }
    ])
    start(host)
    await flush()
    expect(postedBodies()).toEqual(['x: re-announced'])
    expect(persistedSeq()).toBe(8)
  })

  it('same-pane case: the desk retires every announced id, so the old tray banner still clears', async () => {
    vi.mocked(Notifications.getPresentedNotificationsAsync).mockResolvedValue([
      {
        request: {
          identifier: 'codeui:host-1:wt-x',
          content: { data: { hostId: 'host-1', notificationId: id(4) } }
        }
      }
    ] as never)
    const host = makeHost()
    host.setMissed(() => [agentDone(6, 'wt-x', 2, 'x: newer'), dismiss(7, id(4)), dismiss(8, id(6))])
    start(host)
    await flush()
    expect(vi.mocked(Notifications.dismissNotificationAsync).mock.calls.map((c) => c[0])).toContain(
      'codeui:host-1:wt-x'
    )
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled()
  })

  it('silent events enter the seen-set: the same batch served again posts nothing new', async () => {
    const host = makeHost()
    const batch = [agentDone(6, 'wt-x', 2, 'x: first'), agentDone(7, 'wt-x', 1, 'x: second'), dismiss(8, id(9))]
    // A desktop that ignores the cut (residual overlap): the seen-set is the only guard.
    host.setMissed(() => batch)
    start(host)
    await flush()
    expect(postedBodies()).toEqual(['x: second'])
    host.emit({ type: 'ready', subscriptionId: 'sub-2', epoch: 'epoch-1' })
    await flush()
    expect(postedBodies()).toEqual(['x: second'])
    expect(persistedSeq()).toBe(8)
  })
})
