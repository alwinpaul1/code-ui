import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { createFakeComposerHost } from './fake-claude-composer-host.test-support'
import { writeChatSend } from './mobile-native-chat-send-write'
import {
  acquireMobileNativeChatTerminalWrite,
  acquireMobileNativeChatTerminalWriteForSend,
  isMobileNativeChatTerminalWriteInFlight,
  releaseMobileNativeChatTerminalWrite,
  resetMobileNativeChatTerminalWritesForTests
} from './mobile-native-chat-terminal-write-lock'

// The composer send runs under a write lock its caller took (the image hook's
// send). Once the body is written the send only reads, and lets that lock go so
// a card tap is not refused. It must let go the CALLER's lock and nobody else's.

const clientOf = (host: ReturnType<typeof createFakeComposerHost>): RpcClient =>
  ({ sendRequest: host.handle, getState: () => 'connected' }) as unknown as RpcClient

const send = (host: ReturnType<typeof createFakeComposerHost>, terminal: string) =>
  writeChatSend({
    agent: 'claude',
    client: clientOf(host),
    terminal,
    text: 'check the build',
    hasImages: false,
    syncComposer: true,
    classification: 'chat',
    typesCodexCommand: false,
    seed: null,
    residue: null,
    deadline: Date.now() + 15_000,
    deviceToken: null,
    receipts: () => []
  })

describe('the lock a composer send lets go of while it only reads', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetMobileNativeChatTerminalWritesForTests()
  })
  afterEach(() => vi.useRealTimers())

  it('lets go of the lock its caller took for the send', async () => {
    const host = createFakeComposerHost()
    const owner = acquireMobileNativeChatTerminalWriteForSend('A')
    expect(owner).not.toBeNull()
    const sending = send(host, 'A')
    await vi.runAllTimersAsync()
    await sending

    expect(isMobileNativeChatTerminalWriteInFlight('A')).toBe(false)
    // The caller's own release afterwards finds nothing to undo.
    acquireMobileNativeChatTerminalWrite('A')
    releaseMobileNativeChatTerminalWrite('A', owner!)
    expect(isMobileNativeChatTerminalWriteInFlight('A')).toBe(true)
  })

  it('does not let go of a lock another sequence holds on the terminal it sent to', async () => {
    // A tab switch between the caller's lock on tab A and the send resolving the
    // terminal left the send writing to tab B, whose lock a permission tap, a queue
    // edit or an answer holds.
    const host = createFakeComposerHost()
    acquireMobileNativeChatTerminalWriteForSend('A')
    expect(acquireMobileNativeChatTerminalWrite('B')).toBe(true)

    const sending = send(host, 'B')
    await vi.runAllTimersAsync()
    await sending

    expect(isMobileNativeChatTerminalWriteInFlight('B')).toBe(true)
  })

  it('does not take a lock nobody holds for it', async () => {
    const host = createFakeComposerHost()

    const sending = send(host, 'A')
    await vi.runAllTimersAsync()
    await sending

    expect(isMobileNativeChatTerminalWriteInFlight('A')).toBe(false)
  })
})
