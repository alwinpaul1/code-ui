import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionState } from './types'
import type { RpcClient } from './rpc-client'
import type { MobileConnectionPath } from './stable-logical-rpc-client'

// One client per host, across the screen's store, the parked registry and the
// background watcher. Split from client-context.test.ts (max-lines).
//
// Evidence: a Pixel's diagnostics (Orca Mobile 0.9.54 against host 1.4.215,
// 2026-09-27) showed every connection event three times with different
// attempt counters, three E2EE handshakes and three "Authenticated" lines for
// ONE desktop: the screen's client plus two the background watcher had dialled
// beside it and published where the screen never looked.

const connectMock = vi.fn()
const loadHostsMock = vi.fn()

vi.mock('./rpc-client', () => ({
  connect: (...args: unknown[]) => connectMock(...args)
}))
vi.mock('./host-logical-client', () => ({
  openHostLogicalClient: (...args: unknown[]) => connectMock(...args)
}))
vi.mock('./host-store', () => ({
  loadHosts: () => loadHostsMock(),
  // The client opener reads the catalog (host-entry-opener.ts). Every fixture here is a readable
  // desktop, so the catalog is the same list with each entry ready, read through the same mock.
  loadHostCatalog: async () =>
    ((await loadHostsMock()) as { id: string }[]).map((profile) => ({
      ...profile,
      credentialStatus: 'ready',
      profile
    }))
}))
vi.mock('./connection-revival-triggers', () => ({
  subscribeConnectionRevivalTriggers: () => () => {}
}))

import { RpcClientProvider, useHostClient } from './client-context'
import { clearLiveHostClientsForTest, peekLiveHostClient } from './live-host-clients'
import { createBackgroundNotificationWatcher } from '../background/background-notification-watcher'

type FakeClient = RpcClient & {
  emitState: (state: ConnectionState) => void
  closeMock: ReturnType<typeof vi.fn>
}

function makeFakeClient(
  initialState: ConnectionState,
  activePath: MobileConnectionPath = 'tailscale'
): FakeClient {
  let state = initialState
  const listeners = new Set<(state: ConnectionState) => void>()
  const closeMock = vi.fn()
  return {
    sendRequest: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    updateTerminalSubscriptionViewport: vi.fn(),
    getState: () => state,
    getReconnectAttempt: () => 0,
    getLastConnectedAt: () => null,
    getActivePath: () => activePath,
    getPendingPath: () => null,
    onStateChange: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    notifyForeground: vi.fn(),
    close: closeMock,
    closeMock,
    emitState: (next) => {
      state = next
      for (const listener of listeners) {
        listener(next)
      }
    }
  } as FakeClient
}

const HOST = {
  id: 'host-1',
  name: 'Host 1',
  endpoint: 'ws://192.168.137.1:6768',
  deviceToken: 'token',
  publicKeyB64: 'key',
  lastConnected: 0
}

async function renderHarness(hostId: string) {
  let hook: ReturnType<typeof useHostClient> | null = null
  let renderer: ReactTestRenderer | null = null
  function Probe(): null {
    hook = useHostClient(hostId)
    return null
  }
  await act(async () => {
    renderer = create(createElement(RpcClientProvider, null, createElement(Probe)))
  })
  const mounted = renderer as unknown as ReactTestRenderer
  return {
    get hook(): ReturnType<typeof useHostClient> {
      if (!hook) {
        throw new Error('hook not rendered')
      }
      return hook
    },
    unmount: () => mounted.unmount()
  }
}

beforeEach(() => {
  connectMock.mockReset()
  loadHostsMock.mockReset()
  clearLiveHostClientsForTest()
})

describe('one client per host across backgrounds', () => {
  // Pixel diagnostics, 2026-09-27: three clients for one desktop, each logging
  // its own reconnect loop, handshake and "Authenticated" line. The screen's
  // client was reconnecting at every background, the watcher dialled beside it,
  // and the hand-back put that dial where the screen never looked.
  it('keeps the screen on its own reconnecting client, and no other open, after three backgrounds', async () => {
    const screenClient = makeFakeClient('reconnecting')
    connectMock.mockReturnValue(screenClient)
    loadHostsMock.mockResolvedValue([HOST])
    const opened: FakeClient[] = []
    const watcher = createBackgroundNotificationWatcher({
      loadHosts: async () => [HOST],
      openClient: (() => {
        const client = makeFakeClient('connecting')
        opened.push(client)
        return client
      }) as never,
      subscribeNotifications: () => () => {},
      log: () => {}
    })
    const harness = await renderHarness(HOST.id)
    expect(harness.hook.client).toBe(screenClient)
    watcher.setEnabled(true)

    for (let cycle = 0; cycle < 3; cycle++) {
      await act(async () => {
        watcher.setUiVisible(false)
        await Promise.resolve()
        await Promise.resolve()
      })
      await act(async () => {
        watcher.setUiVisible(true)
        await Promise.resolve()
      })
    }

    const stillOpen = [screenClient, ...opened].filter((client) => client.closeMock.mock.calls.length === 0)
    expect(stillOpen).toEqual([screenClient])
    expect(harness.hook.client).toBe(screenClient)
    expect(peekLiveHostClient(HOST.id)).toBe(screenClient)
    expect(screenClient.notifyForeground).toHaveBeenCalledWith('focus')
    expect(screenClient.notifyForeground).not.toHaveBeenCalledWith('network-change')
    act(() => {
      watcher.stop()
      harness.unmount()
    })
  })

  it('lets the background replace a relay left behind by recents once it is rejected, and closes the rejected one', async () => {
    const parked = makeFakeClient('connected', 'relay')
    connectMock.mockReturnValue(parked)
    loadHostsMock.mockResolvedValue([HOST])
    const own = makeFakeClient('connecting')
    const openBackgroundClient = vi.fn(() => own)
    const watcher = createBackgroundNotificationWatcher({
      loadHosts: async () => [HOST],
      openClient: openBackgroundClient as never,
      subscribeNotifications: () => () => {},
      log: () => {}
    })

    const first = await renderHarness(HOST.id)
    act(() => first.unmount())
    // No screen holds it now. A rejected login cannot replace itself, and
    // nothing but the background can act on it until the app is opened.
    act(() => parked.emitState('auth-failed'))
    watcher.setEnabled(true)
    await act(async () => {
      watcher.setUiVisible(false)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(openBackgroundClient).toHaveBeenCalledOnce()
    expect(parked.closeMock).toHaveBeenCalledOnce()
    act(() => watcher.stop())
  })

  // Review of this fix, 2026-09-27: borrowing a client that is down means a
  // Recents swipe closes the very client the watcher listens on (a dead entry
  // is closed, not parked). The watcher kept the closed link, and nothing
  // listened for that desktop until the app was opened again.
  it('keeps listening after recents closes the down client the background had borrowed', async () => {
    const screenClient = makeFakeClient('disconnected', 'relay')
    screenClient.closeMock.mockImplementation(() => screenClient.emitState('disconnected'))
    connectMock.mockReturnValue(screenClient)
    loadHostsMock.mockResolvedValue([HOST])
    const own = makeFakeClient('connecting')
    const openBackgroundClient = vi.fn(() => own)
    const watcher = createBackgroundNotificationWatcher({
      loadHosts: async () => [HOST],
      openClient: openBackgroundClient as never,
      subscribeNotifications: () => () => {},
      log: () => {}
    })
    const harness = await renderHarness(HOST.id)
    watcher.setEnabled(true)
    await act(async () => {
      watcher.setUiVisible(false)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(openBackgroundClient).not.toHaveBeenCalled()

    await act(async () => {
      harness.unmount()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screenClient.closeMock).toHaveBeenCalledOnce()
    expect(openBackgroundClient).toHaveBeenCalledOnce()
    expect(watcher.isListening()).toBe(true)
    own.emitState('connected')
    expect(watcher.peekClient(HOST.id)).toBe(own)
    act(() => watcher.stop())
  })

  it('closes a parked relay that died while the screen was gone, instead of dialling beside it', async () => {
    const parked = makeFakeClient('connected', 'relay')
    const replacement = makeFakeClient('connected')
    connectMock.mockReturnValueOnce(parked).mockReturnValueOnce(replacement)
    loadHostsMock.mockResolvedValue([HOST])

    const first = await renderHarness(HOST.id)
    act(() => first.unmount())
    expect(parked.closeMock).not.toHaveBeenCalled()
    // The relay dropped with no screen up. The client is not closed: its
    // supervisor keeps running, and nothing but this open can ever close it.
    act(() => parked.emitState('disconnected'))

    const second = await renderHarness(HOST.id)
    expect(second.hook.client).toBe(replacement)
    expect(parked.closeMock).toHaveBeenCalledOnce()
    expect(peekLiveHostClient(HOST.id)).toBe(replacement)
    second.unmount()
  })
})
