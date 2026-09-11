import { describe, expect, it, vi } from 'vitest'
import { createBackgroundNotificationWatcher } from './background-notification-watcher'
import type { ConnectionState, HostProfile } from '../transport/types'

// The UI owns the host connections while it is on screen; this watcher owns
// them while it is not. Android tears the React tree down when the app is
// swiped out of Recents, so nothing in that tree can be the thing that keeps
// agent notifications flowing.

type FakeClient = {
  getState: () => ConnectionState
  onStateChange: (listener: (state: ConnectionState) => void) => () => void
  close: () => void
  setState: (next: ConnectionState) => void
}

function makeClient(): FakeClient {
  let state: ConnectionState = 'connecting'
  const listeners = new Set<(state: ConnectionState) => void>()
  return {
    getState: () => state,
    onStateChange: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close: vi.fn(),
    setState: (next) => {
      state = next
      listeners.forEach((listener) => listener(next))
    }
  }
}

const hosts = [
  { id: 'h1', name: 'Studio' } as HostProfile,
  { id: 'h2', name: 'Laptop' } as HostProfile
]

function harness(liveClients = new Map<string, FakeClient>()) {
  const clients = new Map<string, FakeClient>()
  const unsubscribes = new Map<string, ReturnType<typeof vi.fn>>()
  const subscribe = vi.fn((_client: unknown, hostId: string) => {
    const unsubscribe = vi.fn()
    unsubscribes.set(hostId, unsubscribe)
    return unsubscribe
  })
  const openClient = vi.fn((host: HostProfile) => {
    const client = makeClient()
    clients.set(host.id, client)
    return client
  })
  const watcher = createBackgroundNotificationWatcher({
    loadHosts: async () => hosts,
    openClient: openClient as never,
    subscribeNotifications: subscribe as never,
    peekLiveClient: ((hostId: string) => liveClients.get(hostId) ?? null) as never,
    log: () => {}
  })
  return { watcher, clients, openClient, subscribe, unsubscribes }
}

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('background notification watcher', () => {
  it('opens a client per paired host once the UI leaves the screen and delivery is on', async () => {
    const { watcher, openClient, subscribe, clients } = harness()
    watcher.setEnabled(true)
    watcher.setUiVisible(true)
    await settle()
    expect(openClient).not.toHaveBeenCalled()

    watcher.setUiVisible(false)
    await settle()
    expect(openClient.mock.calls.map(([host]) => host.id)).toEqual(['h1', 'h2'])
    expect(subscribe).not.toHaveBeenCalled()

    clients.get('h1')!.setState('connected')
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(subscribe.mock.calls[0]![1]).toBe('h1')
  })

  it('hands the connections back to the UI when it returns, unsubscribing and closing', async () => {
    const { watcher, clients, unsubscribes } = harness()
    watcher.setEnabled(true)
    watcher.setUiVisible(false)
    await settle()
    clients.get('h1')!.setState('connected')

    watcher.setUiVisible(true)
    await settle()
    expect(unsubscribes.get('h1')).toHaveBeenCalledTimes(1)
    expect(clients.get('h1')!.close).toHaveBeenCalledTimes(1)
    expect(clients.get('h2')!.close).toHaveBeenCalledTimes(1)
  })

  it('does nothing while delivery is off, and closes everything when it is switched off', async () => {
    const { watcher, openClient, clients } = harness()
    watcher.setUiVisible(false)
    await settle()
    expect(openClient).not.toHaveBeenCalled()

    watcher.setEnabled(true)
    await settle()
    expect(openClient).toHaveBeenCalledTimes(2)

    watcher.setEnabled(false)
    await settle()
    expect(clients.get('h1')!.close).toHaveBeenCalled()
    expect(clients.get('h2')!.close).toHaveBeenCalled()
  })

  it('survives a UI flip while the host list is still loading without leaking a client', async () => {
    let release: (hosts: HostProfile[]) => void = () => {}
    const openClient = vi.fn(() => makeClient())
    const watcher = createBackgroundNotificationWatcher({
      loadHosts: () => new Promise((resolve) => (release = resolve)),
      openClient: openClient as never,
      subscribeNotifications: (() => () => {}) as never,
      log: () => {}
    })
    watcher.setEnabled(true)
    watcher.setUiVisible(false)
    await settle()
    watcher.setUiVisible(true)
    release(hosts)
    await settle()
    expect(openClient).not.toHaveBeenCalled()
  })
})

describe('sharing the connection the UI already holds', () => {
  /** Measured on a Galaxy S23 over ten 10 s background cycles: ten watcher
   *  dials, each a billed 2.3–2.8 s relay splice, while the UI's own session
   *  stayed retained and connected throughout. The second session was
   *  redundant, not harmful — nothing was evicted or lost — but it was paid for
   *  on every background. */
  it('borrows the UI\'s live client instead of dialling a second session', async () => {
    const live = makeClient()
    live.setState('connected')
    const { watcher, openClient, subscribe } = harness(new Map([['h1', live]]))
    watcher.setEnabled(true)
    watcher.setUiVisible(false)
    await settle()

    // h1 rides the UI's connection; only h2, with no live client, is dialled.
    expect(openClient.mock.calls.map(([host]) => host.id)).toEqual(['h2'])
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(subscribe.mock.calls[0]![0]).toBe(live)
  })

  it('hands a borrowed client back without closing it', async () => {
    const live = makeClient()
    live.setState('connected')
    const { watcher, unsubscribes } = harness(new Map([['h1', live]]))
    watcher.setEnabled(true)
    watcher.setUiVisible(false)
    await settle()

    watcher.setUiVisible(true)
    await settle()

    expect(unsubscribes.get('h1')).toHaveBeenCalledTimes(1)
    expect(live.close).not.toHaveBeenCalled()
  })

  it('dials its own link when the borrowed UI client is suspended in the background', async () => {
    // Why: the UI suspends its relay 30 s after backgrounding; reviewed
    // 2026-09-11, the borrowed host stayed listed and notifications stopped.
    const live = makeClient()
    live.setState('connected')
    const { watcher, openClient, unsubscribes } = harness(new Map([['h1', live]]))
    watcher.setEnabled(true)
    watcher.setUiVisible(false)
    await settle()
    expect(openClient.mock.calls.map(([host]) => host.id)).toEqual(['h2'])

    live.setState('disconnected')
    await settle()

    expect(unsubscribes.get('h1')).toHaveBeenCalledTimes(1)
    expect(openClient.mock.calls.map(([host]) => host.id)).toEqual(['h2', 'h1'])
    expect(live.close).not.toHaveBeenCalled()
  })

  it('still dials its own when the UI\'s client is not connected', async () => {
    const live = makeClient() // 'connecting': nothing to borrow yet
    const { watcher, openClient } = harness(new Map([['h1', live]]))
    watcher.setEnabled(true)
    watcher.setUiVisible(false)
    await settle()

    expect(openClient.mock.calls.map(([host]) => host.id)).toEqual(['h1', 'h2'])
  })
})
