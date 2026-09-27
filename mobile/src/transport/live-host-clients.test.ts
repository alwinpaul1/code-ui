import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from './rpc-client'
import type { ConnectionState } from './types'
import {
  clearLiveHostClientsForTest,
  handBackLiveHostClient,
  isLiveHostClientHeldByScreen,
  parkLiveHostClient,
  peekLiveHostClient,
  publishLiveHostClient,
  retireLiveHostClient,
  subscribeLiveHostClientRetired
} from './live-host-clients'

const client = (tag: string) => ({ tag }) as unknown as RpcClient

function clientIn(state: ConnectionState): RpcClient & { close: ReturnType<typeof vi.fn> } {
  return { getState: () => state, close: vi.fn() } as unknown as RpcClient & {
    close: ReturnType<typeof vi.fn>
  }
}

afterEach(() => {
  clearLiveHostClientsForTest()
})

describe("the UI's live clients, seen from outside React", () => {
  it('lets the background watcher find the connection the UI holds', () => {
    const live = client('a')
    publishLiveHostClient('h1', live)

    expect(peekLiveHostClient('h1')).toBe(live)
    expect(peekLiveHostClient('h2')).toBeNull()
  })

  it('forgets a client the UI has closed', () => {
    const live = client('a')
    publishLiveHostClient('h1', live)

    retireLiveHostClient('h1', live)

    expect(peekLiveHostClient('h1')).toBeNull()
  })

  it('does not let a stale retire evict a newer client for the same host', () => {
    // A host can be reopened while an older entry is still being torn down;
    // the older teardown must not take the new connection with it.
    const older = client('old')
    const newer = client('new')
    publishLiveHostClient('h1', older)
    publishLiveHostClient('h1', newer)

    retireLiveHostClient('h1', older)

    expect(peekLiveHostClient('h1')).toBe(newer)
  })
})

// One client per host. The background watcher hands back a client it had to
// dial itself; the registry decides whether it becomes the host's client or
// is refused (and then closed by the watcher) because the host has one.
describe('handing a background client back', () => {
  it('parks it when the host has no client', () => {
    const own = clientIn('connected')

    expect(handBackLiveHostClient('h1', own)).toBe(true)

    expect(peekLiveHostClient('h1')).toBe(own)
    expect(isLiveHostClientHeldByScreen('h1')).toBe(false)
  })

  it('refuses it when the screen holds a client for the host, even a down one', () => {
    const screen = clientIn('disconnected')
    publishLiveHostClient('h1', screen)

    expect(handBackLiveHostClient('h1', clientIn('connected'))).toBe(false)

    expect(peekLiveHostClient('h1')).toBe(screen)
    expect(screen.close).not.toHaveBeenCalled()
  })

  it('refuses it when a live client is already parked for the host', () => {
    const parked = clientIn('reconnecting')
    publishLiveHostClient('h1', parked)
    parkLiveHostClient('h1', parked)

    expect(handBackLiveHostClient('h1', clientIn('connected'))).toBe(false)

    expect(peekLiveHostClient('h1')).toBe(parked)
    expect(parked.close).not.toHaveBeenCalled()
  })

  it('closes a dead parked client nobody holds and parks the new one in its place', () => {
    const dead = clientIn('auth-failed')
    publishLiveHostClient('h1', dead)
    parkLiveHostClient('h1', dead)
    const retired = vi.fn()
    const unsubscribe = subscribeLiveHostClientRetired(retired)
    const own = clientIn('connected')

    expect(handBackLiveHostClient('h1', own)).toBe(true)

    expect(dead.close).toHaveBeenCalledOnce()
    expect(retired).toHaveBeenCalledWith('h1', dead)
    expect(peekLiveHostClient('h1')).toBe(own)
    unsubscribe()
  })
})

describe('telling a borrower its client is gone', () => {
  it('reports the client a holder retires, and nothing for a stale retire', () => {
    const current = clientIn('connected')
    publishLiveHostClient('h1', current)
    const retired = vi.fn()
    const unsubscribe = subscribeLiveHostClientRetired(retired)

    retireLiveHostClient('h1', clientIn('connected'))
    expect(retired).not.toHaveBeenCalled()

    retireLiveHostClient('h1', current)
    expect(retired.mock.calls).toEqual([['h1', current]])

    retireLiveHostClient('h1')
    expect(retired).toHaveBeenCalledOnce()
    unsubscribe()
  })
})
