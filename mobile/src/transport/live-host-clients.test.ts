import { afterEach, describe, expect, it } from 'vitest'
import type { RpcClient } from './rpc-client'
import {
  clearLiveHostClientsForTest,
  peekLiveHostClient,
  publishLiveHostClient,
  retireLiveHostClient
} from './live-host-clients'

const client = (tag: string) => ({ tag }) as unknown as RpcClient

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
