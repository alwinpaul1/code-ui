// The body of a send refuses to start with less than MOBILE_NATIVE_CHAT_MIN_WRITE_TIMEOUT_MS (2 s) of
// its budget left. A shell-command send takes one more look at the screen before the body (the
// baseline a repeated command has to exceed), and that look must not spend what the body needs:
// on a slow relay and a short budget a plain send got through and `!ls -la` was refused after the
// clear had already gone out.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { EMPTY_COMPOSER } from './fixtures/claude-composer-2.1.287'
import { writeChatSend } from './mobile-native-chat-send-write'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'

vi.mock('./mobile-native-chat-stale-input', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mobile-native-chat-stale-input')>()),
  healMobileNativeChatStaleInput: () => Promise.resolve(true)
}))

const READ_MS = 900
const SEND_MS = 300

function slowHost() {
  const sends: string[] = []
  const reads: number[] = []
  const origin = Date.now()
  const client = {
    getState: () => 'connected',
    sendRequest: vi.fn(async (method: string, params?: unknown, options?: { timeoutMs?: number }) => {
      if (method === 'terminal.read') {
        reads.push(Date.now() - origin)
        // A relay that answers in READ_MS, and a request that gives up at its own timeout.
        const limit = options?.timeoutMs ?? Infinity
        await new Promise((resolve) => setTimeout(resolve, Math.min(READ_MS, limit)))
        if (limit < READ_MS) {
          throw new Error('Request timed out')
        }
        return {
          id: 'r',
          ok: true,
          result: { terminal: { tail: EMPTY_COMPOSER, source: 'screen', draft: '' } },
          _meta: { runtimeId: 'r' }
        }
      }
      sends.push(String((params as { text?: string }).text ?? ''))
      await new Promise((resolve) => setTimeout(resolve, SEND_MS))
      return { id: 'r', ok: true, result: { send: { accepted: true } }, _meta: { runtimeId: 'r' } }
    })
  } as unknown as RpcClient
  return { client, sends, reads }
}

const write = (client: RpcClient, text: string, agent: string, budgetMs: number) =>
  writeChatSend({
    agent,
    client,
    terminal: 'term',
    text,
    hasImages: false,
    syncComposer: true,
    classification: 'chat',
    typesCodexCommand: false,
    seed: null,
    residue: null,
    deadline: Date.now() + budgetMs,
    deviceToken: null,
    receipts: () => []
  })

beforeEach(() => {
  vi.useFakeTimers()
  resetMobileNativeChatTerminalWritesForTests()
  resetMobileNativeChatStaleInputForTests()
})
afterEach(() => {
  vi.useRealTimers()
})

async function run<T>(start: () => Promise<T>): Promise<T> {
  const running = start()
  await vi.runAllTimersAsync()
  return running
}

describe('a send on a slow relay and a short budget', () => {
  it.each([4_500, 4_800, 5_000])('writes a shell command as it writes a plain message, with %i ms', async (budget) => {
    const plain = slowHost()
    const plainResult = await run(() => write(plain.client, 'check the build', 'claude', budget))
    const shell = slowHost()
    const shellResult = await run(() => write(shell.client, '!ls -la', 'claude', budget))

    expect(plainResult).toMatchObject({ kind: 'written' })
    expect(plain.sends.some((text) => text.includes('check the build'))).toBe(true)
    expect(shellResult).toMatchObject({ kind: 'written' })
    expect(shellResult).not.toMatchObject({ outcome: 'rejected' })
    expect(shell.sends.some((text) => text.includes('!ls -la'))).toBe(true)
  })

  it('reads no baseline for Codex, which has no use for one', async () => {
    const shell = slowHost()
    await run(() => write(shell.client, '!ls -la', 'codex', 15_000))
    const plain = slowHost()
    await run(() => write(plain.client, 'ls -la', 'codex', 15_000))
    expect(shell.reads.length).toBe(plain.reads.length)
  })

  it('reads one more screen for a Claude shell command than for a plain message, with room for it', async () => {
    const shell = slowHost()
    await run(() => write(shell.client, '!ls -la', 'claude', 15_000))
    const plain = slowHost()
    await run(() => write(plain.client, 'ls -la', 'claude', 15_000))
    expect(shell.reads.length).toBe(plain.reads.length + 1)
  })

  it('still writes a shell command on a roomy budget, with its baseline read', async () => {
    const roomy = slowHost()
    const baselineReads = roomy.reads
    await run(() => write(roomy.client, '!ls -la', 'claude', 15_000))
    expect(roomy.sends.some((text) => text.includes('!ls -la'))).toBe(true)
    expect(baselineReads.length).toBeGreaterThanOrEqual(4)
  })
})
