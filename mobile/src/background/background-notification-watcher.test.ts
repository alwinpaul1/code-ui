import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createBackgroundNotificationWatcher,
  isBackgroundRelayListening
} from './background-notification-watcher'
import type { ConnectionState, HostProfile } from '../transport/types'
import {
  clearLiveHostClientsForTest,
  parkLiveHostClient,
  peekLiveHostClient,
  publishLiveHostClient
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

beforeEach(() => {
  clearLiveHostClientsForTest()
})

/** `liveClients` are the screen's own: published into the registry the way
 *  its store publishes an entry. */
function harness(liveClients = new Map<string, FakeClient>()) {
  for (const [hostId, client] of liveClients) {
    publishLiveHostClient(hostId, client as never)
  }
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
    publishLiveHostClient('h1', live as never)
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

  // A second dial beside a client the screen holds is never used: on return
  // the screen keeps its own entry. So a rejection the screen's client took is
  // left to that client's own recovery, and nudged once like any other drop.
  it('nudges the screen\'s rejected client instead of dialling a second one beside it', async () => {
    const live = makeClient()
    live.setState('connected')
    const { watcher, openClient } = harness(new Map([['h1', live]]))
    watcher.setEnabled(true)
    watcher.setUiVisible(false)
    await settle()

    live.setState('auth-failed')
    await settle()

    expect(openClient.mock.calls.map(([host]) => host.id)).toEqual(['h2'])
    expect(live.notifyForeground).toHaveBeenCalledOnce()
    expect(live.close).not.toHaveBeenCalled()
    expect(peekLiveHostClient('h1')).toBe(live)
  })

  it('replaces a parked client that is rejected while no screen holds it, closing it first', async () => {
    const parked = makeClient()
    parked.setState('connected')
    const { watcher, openClient, clients } = harness(new Map([['h1', parked]]))
    parkLiveHostClient('h1', parked as never)
    watcher.setEnabled(true)
    watcher.setUiVisible(false)
    await settle()

    parked.setState('auth-failed')
    await settle()

    expect(openClient.mock.calls.map(([host]) => host.id)).toEqual(['h2', 'h1'])
    expect(parked.close).toHaveBeenCalledOnce()
    expect(peekLiveHostClient('h1')).toBeNull()

    // Back on screen: the replacement is parked for the screen to take.
    clients.get('h1')!.setState('connected')
    watcher.setUiVisible(true)
    await settle()
    expect(peekLiveHostClient('h1')).toBe(clients.get('h1'))
    expect(clients.get('h1')!.close).not.toHaveBeenCalled()
  })

  it('borrows the screen\'s client while it is still dialling, and nudges it instead of dialling beside it', async () => {
    const live = makeClient() // 'connecting'
    const { watcher, openClient } = harness(new Map([['h1', live]]))
    watcher.setEnabled(true)
    watcher.setUiVisible(false)
    await settle()

    expect(openClient.mock.calls.map(([host]) => host.id)).toEqual(['h2'])
    // Not 'network-change': nothing changed, and that nudge forgets the direct
    // verdict, so every background would restart the wait on a dead LAN.
    expect(vi.mocked(live.notifyForeground).mock.calls).toEqual([['focus']])
  })

  it('closes a dead parked client and dials its own when no screen holds the host', async () => {
    const parked = makeClient()
    parked.setState('auth-failed')
    const { watcher, openClient } = harness(new Map([['h1', parked]]))
    parkLiveHostClient('h1', parked as never)
    watcher.setEnabled(true)
    watcher.setUiVisible(false)
    await settle()

    expect(openClient.mock.calls.map(([host]) => host.id)).toEqual(['h1', 'h2'])
    expect(parked.close).toHaveBeenCalledOnce()
    expect(peekLiveHostClient('h1')).toBeNull()
  })
})

describe('one client per host across backgrounds', () => {
  // A friend's Pixel (Orca Mobile 0.9.54, 2026-09-27) logged every connection
  // event three times with different attempt counters, three E2EE handshakes
  // and three "Authenticated" lines for ONE desktop. The screen's client was
  // reconnecting when the app went to the background, so the watcher dialled a
  // second one; on return it published that one into the registry, but the
  // screen kept returning its own store entry, so the second client was never
  // used and never closed. One more per hide/show.
  it('keeps one client for the host after three backgrounds while the screen\'s client is reconnecting', async () => {
    const screen = makeClient()
    screen.setState('reconnecting')
    publishLiveHostClient('h1', screen as never)
    const opened: FakeClient[] = []
    const watcher = createBackgroundNotificationWatcher({
      loadHosts: async () => [hosts[0]!],
      openClient: (() => {
        const client = makeClient()
        opened.push(client)
        return client
      }) as never,
      subscribeNotifications: (() => () => {}) as never,
      log: () => {}
    })
    watcher.setEnabled(true)

    for (let cycle = 0; cycle < 3; cycle++) {
      watcher.setUiVisible(false)
      await settle()
      watcher.setUiVisible(true)
      await settle()
    }

    const stillOpen = [screen, ...opened].filter((client) => !vi.mocked(client.close).mock.calls.length)
    expect(stillOpen).toHaveLength(1)
    expect(stillOpen[0]).toBe(screen)
    expect(peekLiveHostClient('h1')).toBe(screen)
    watcher.stop()
  })
})
