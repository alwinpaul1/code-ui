import { describe, expect, it, vi } from 'vitest'
import {
  createBackgroundNotificationWatcher,
  isBackgroundRelayListening
} from './background-notification-watcher'
import type { ConnectionState, HostProfile } from '../transport/types'
import {
  clearLiveHostClientsForTest,
  peekLiveHostClient
} from '../transport/live-host-clients'

// The UI owns the host connections while it is on screen; this watcher owns
// them while it is not. Android tears the React tree down when the app is
// swiped out of Recents, so nothing in that tree can be the thing that keeps
// agent notifications flowing.

type FakeClient = {
  getState: () => ConnectionState
  onStateChange: (listener: (state: ConnectionState) => void) => () => void
  close: () => void
  notifyForeground: (reason: string) => void
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
    notifyForeground: vi.fn(),
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

  // A notification's Approve button answers over a client, and the tap handler
  // used to look only in the UI's registry — empty exactly when the watcher is
  // the one listening. The watcher lends out the link it is listening on.
  it('lends out the connected link it is listening on, so a button tap can answer over it', async () => {
    const { watcher, clients } = harness()
    watcher.setEnabled(true)
    watcher.setUiVisible(false)
    await settle()
    expect(watcher.peekClient('h1')).toBeNull()
    clients.get('h1')!.setState('connected')
    expect(watcher.peekClient('h1')).toBe(clients.get('h1'))
    expect(watcher.peekClient('h2')).toBeNull()
    expect(watcher.peekClient('nope')).toBeNull()

    watcher.setUiVisible(true)
    await settle()
    expect(watcher.peekClient('h1')).toBeNull()
  })

  it('gives the background relay back when the app opens, without dialling again', async () => {
    clearLiveHostClientsForTest()
    const { watcher, clients, unsubscribes } = harness()
    watcher.setEnabled(true)
    watcher.setUiVisible(false)
    await settle()
    clients.get('h1')!.setState('connected')

    // The process stayed up and this dial is the relay. Closing it here made
    // the screen start a second one and show Reconnecting (device, 2026-09-22).
    watcher.setUiVisible(true)
    await settle()
    expect(unsubscribes.get('h1')).toHaveBeenCalledTimes(1)
    expect(clients.get('h1')!.close).not.toHaveBeenCalled()
    expect(clients.get('h2')!.close).not.toHaveBeenCalled()
    expect(peekLiveHostClient('h1')).toBe(clients.get('h1'))
    expect(peekLiveHostClient('h2')).toBe(clients.get('h2'))
  })

  it('reconnects the background relay when the network changes', async () => {
    const live = makeClient()
    live.setState('connected')
    const { watcher, openClient } = harness(new Map([['h1', live]]))
    watcher.setEnabled(true)
    watcher.setUiVisible(false)
    await settle()

    watcher.reconnectForNetworkChange()

    expect(live.notifyForeground).toHaveBeenCalledWith('network-change')
    expect(openClient.mock.calls.map(([host]) => host.id)).toEqual(['h2'])
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

  it('drops the background-hold flag when the borrowed socket dies and the screen returns before a replacement opens', async () => {
    const live = makeClient()
    live.setState('connected')
    let releaseSecond: (hosts: HostProfile[]) => void = () => {}
    let calls = 0
    const watcher = createBackgroundNotificationWatcher({
      loadHosts: () => {
        calls += 1
        if (calls === 1) {
          return Promise.resolve([hosts[0]!])
        }
        return new Promise((resolve) => {
          releaseSecond = resolve
        })
      },
      openClient: (() => makeClient()) as never,
      subscribeNotifications: (() => () => {}) as never,
      peekLiveClient: ((hostId: string) => (hostId === 'h1' ? live : null)) as never,
      log: () => {}
    })
    watcher.setEnabled(true)
    watcher.setUiVisible(false)
    await settle()
    expect(isBackgroundRelayListening()).toBe(true)

    // Wi-Fi dropped the borrowed socket. The replacement host list is still
    // in flight when the screen comes back (device, 2026-09-22).
    live.setState('disconnected')
    await settle()
    watcher.setUiVisible(true)
    await settle()

    expect(isBackgroundRelayListening()).toBe(false)
    releaseSecond([hosts[0]!])
    await settle()
    expect(isBackgroundRelayListening()).toBe(false)
    watcher.stop()
  })

  it('replaces the borrowed relay when it drops, instead of dialling a second one', async () => {
    // A second dial connected in the background while the screen kept the
    // dead socket, so opening the app showed Reconnecting (device, 2026-09-22).
    const live = makeClient()
    live.setState('connected')
    const { watcher, openClient, unsubscribes } = harness(new Map([['h1', live]]))
    watcher.setEnabled(true)
    watcher.setUiVisible(false)
    await settle()
    expect(openClient.mock.calls.map(([host]) => host.id)).toEqual(['h2'])

    live.setState('disconnected')
    await settle()

    expect(live.notifyForeground).toHaveBeenCalledWith('network-change')
    expect(openClient.mock.calls.map(([host]) => host.id)).toEqual(['h2'])
    expect(unsubscribes.get('h1')).toHaveBeenCalledTimes(1)
    expect(live.close).not.toHaveBeenCalled()

    live.setState('reconnecting')
    expect(live.notifyForeground).toHaveBeenCalledTimes(1)
  })

  it('dials its own link when the borrowed relay is rejected', async () => {
    const live = makeClient()
    live.setState('connected')
    const { watcher, openClient } = harness(new Map([['h1', live]]))
    watcher.setEnabled(true)
    watcher.setUiVisible(false)
    await settle()

    live.setState('auth-failed')
    await settle()

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
