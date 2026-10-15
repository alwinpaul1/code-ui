import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Whether the phone itself has no network, for a matched Claude tab's "You’re offline. The rest of
// Claude’s reply will appear when you reconnect." (the Claude app's `chat_footer_polling_offline`,
// zr8.java:1097-1099). Fail-open: anything short of the OS saying "not connected" reads online, so
// a broken reading never puts the offline sentence over a working chat.

type Listener = (state: { isConnected?: boolean | null; type?: string }) => void
const net = vi.hoisted(() => ({
  listeners: [] as Listener[],
  removed: 0,
  initial: Promise.resolve({ isConnected: true }) as Promise<{ isConnected?: boolean | null }>,
  listenerThrows: false
}))
vi.mock('expo-network', () => ({
  getNetworkStateAsync: () => net.initial,
  addNetworkStateListener: (listener: Listener) => {
    if (net.listenerThrows) {
      throw new Error('native module missing')
    }
    net.listeners.push(listener)
    return { remove: () => (net.removed += 1) }
  }
}))

import { usePhoneOffline } from './use-phone-offline'

describe('whether the phone is offline', () => {
  let renderer: ReactTestRenderer | null = null
  let seen: boolean | null = null
  function Harness({ enabled }: { enabled: boolean }): null {
    seen = usePhoneOffline(enabled)
    return null
  }
  async function mount(enabled = true): Promise<void> {
    await act(async () => {
      renderer = create(createElement(Harness, { enabled }))
      await Promise.resolve()
    })
  }
  beforeEach(() => {
    net.listeners = []
    net.removed = 0
    net.initial = Promise.resolve({ isConnected: true })
    net.listenerThrows = false
    seen = null
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('reads offline when the OS says the phone has no connection at launch', async () => {
    net.initial = Promise.resolve({ isConnected: false })
    await mount()
    expect(seen).toBe(true)
  })

  it('follows the network dropping and coming back', async () => {
    await mount()
    expect(seen).toBe(false)
    act(() => net.listeners.forEach((listener) => listener({ isConnected: false })))
    expect(seen).toBe(true)
    act(() => net.listeners.forEach((listener) => listener({ isConnected: true })))
    expect(seen).toBe(false)
  })

  it('a reading that does not say (null or absent) is online', async () => {
    net.initial = Promise.resolve({ isConnected: null })
    await mount()
    act(() => net.listeners.forEach((listener) => listener({})))
    expect(seen).toBe(false)
  })

  it('a failed first reading is online, and a later change is still heard', async () => {
    net.initial = Promise.reject(new Error('no permission'))
    await mount()
    expect(seen).toBe(false)
    act(() => net.listeners.forEach((listener) => listener({ isConnected: false })))
    expect(seen).toBe(true)
  })

  it('a first reading that lands after a change does not undo the change', async () => {
    let resolve: (state: { isConnected: boolean }) => void = () => undefined
    net.initial = new Promise((done) => (resolve = done))
    await mount()
    act(() => net.listeners.forEach((listener) => listener({ isConnected: false })))
    await act(async () => {
      resolve({ isConnected: true })
      await Promise.resolve()
    })
    expect(seen).toBe(true)
  })

  it('a listener that cannot be added is online, not a crash', async () => {
    net.listenerThrows = true
    await mount()
    expect(seen).toBe(false)
  })

  it('reads nothing and listens to nothing when not asked', async () => {
    net.initial = Promise.resolve({ isConnected: false })
    await mount(false)
    expect(seen).toBe(false)
    expect(net.listeners).toHaveLength(0)
  })

  it('stops listening on unmount', async () => {
    await mount()
    act(() => renderer?.unmount())
    renderer = null
    expect(net.removed).toBe(1)
  })
})
