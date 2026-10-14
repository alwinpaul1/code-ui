import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'

const links = vi.hoisted(() => ({
  live: new Map<string, unknown>(),
  background: new Map<string, unknown>(),
  catalog: [] as { id: string; credentialStatus: string }[],
  catalogFails: false
}))

vi.mock('../transport/live-host-clients', () => ({ peekLiveHostClient: (id: string) => links.live.get(id) ?? null }))
vi.mock('../background/background-link', () => ({
  getBackgroundLinkWatcher: () => ({ peekClient: (id: string) => links.background.get(id) ?? null })
}))
vi.mock('../transport/host-store', () => ({
  loadHostCatalog: async () => {
    if (links.catalogFails) {
      throw new Error('keychain locked')
    }
    return links.catalog
  }
}))
vi.mock('../session/structured-session-operation-id', () => ({
  structuredSessionOperationId: () => 'op-test',
  structuredSessionRandomUuid: () => '0123456789abcdef0123'
}))

import { nativeChatOutboxEntries, resetNativeChatOutboxForTests } from '../storage/native-chat-outbox'
import { productionSessionReplyIo } from './session-reply-io'

const A = { id: 'live-client' } as unknown as RpcClient
const B = { id: 'background-client' } as unknown as RpcClient

beforeEach(() => {
  links.live.clear()
  links.background.clear()
  links.catalog = []
  links.catalogFails = false
  resetNativeChatOutboxForTests()
})

// What the reply path touches on a phone (session-reply-io.ts).
describe('the reply path’s links and stores on a phone', () => {
  it('uses the UI’s link to the host first, as the shade’s other buttons do', () => {
    links.live.set('host-1', A)
    links.background.set('host-1', B)
    expect(productionSessionReplyIo().resolveClient('host-1')).toBe(A)
  })

  it('falls back to the background watcher’s, the only one there is with the app in the background', () => {
    links.background.set('host-1', B)
    expect(productionSessionReplyIo().resolveClient('host-1')).toBe(B)
  })

  it('has no link when neither has one', () => {
    expect(productionSessionReplyIo().resolveClient('host-1')).toBeNull()
  })

  it('reads the host’s credential status from the catalog', async () => {
    links.catalog = [
      { id: 'host-1', credentialStatus: 'missing' },
      { id: 'host-2', credentialStatus: 'temporarily-unavailable' }
    ]
    const io = productionSessionReplyIo()
    expect(await io.hostCredential('host-1')).toBe('missing')
    expect(await io.hostCredential('host-2')).toBe('temporarily-unavailable')
    expect(await io.hostCredential('host-3')).toBeNull()
  })

  it('reads no status, rather than throwing, when the catalog cannot be read', async () => {
    links.catalogFails = true
    expect(await productionSessionReplyIo().hostCredential('host-1')).toBeNull()
  })

  it('reads no tab list from a host that refuses the read', async () => {
    const client = {
      getState: () => 'connected',
      sendRequest: async () => ({ ok: false, error: { code: 'nope', message: 'refused' } })
    } as unknown as RpcClient
    expect(await productionSessionReplyIo().readTabs(client, 'wt-1')).toBeNull()
  })

  it('reads no tab list from a link that throws', async () => {
    const client = {
      getState: () => 'connected',
      sendRequest: async () => {
        throw new Error('socket closed')
      }
    } as unknown as RpcClient
    expect(await productionSessionReplyIo().readTabs(client, 'wt-1')).toBeNull()
  })

  it('appends to the outbox the composer writes to, and reports it on disk', async () => {
    const entry = {
      id: 'send-1',
      draftKey: 'k',
      pendingKey: null,
      text: 'hi',
      normalizedText: 'hi',
      baselineOccurrences: 0,
      baselineTailMessageId: null,
      baselineResolved: false,
      createdAt: 1,
      operationId: 'op',
      autoAttempts: 0
    }
    expect(await productionSessionReplyIo().writeEntry(entry)).toBe(true)
    expect(nativeChatOutboxEntries().map((kept) => kept.id)).toEqual(['send-1'])
  })

  it('makes ids the way the composer does, each one new', () => {
    const io = productionSessionReplyIo()
    const first = io.newId()
    expect(first).toMatch(/^send-\d+-0123456789ab$/)
    expect(io.newOperationId()).toBe('op-test')
  })
})
