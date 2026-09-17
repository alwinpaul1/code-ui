import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { CLAUDE_SEND_NOW_BYTES, canSendQueueNow, sendClaudeQueueNow } from './claude-send-queue-now'

/**
 * Claude Code 2.1.275 added a send-now key: it interrupts the current turn and
 * sends every queued message at once. Two bindings, and only one survives a
 * terminal: ctrl+enter is indistinguishable from enter on most of them, which
 * is why the release also bound ctrl+x ctrl+s — two bytes any PTY can carry.
 * That is the one the phone sends.
 *
 * Verified against the 2.1.275 binary's own strings ("ctrl+x ctrl+s",
 * "input_send_now_key", "queued_send_now") and the release notes, not against a
 * phone; the sequence is the documented one and nothing here interprets it.
 */
describe('sending the queue now', () => {
  it('is the two-byte binding, not ctrl+enter', () => {
    expect(CLAUDE_SEND_NOW_BYTES).toBe('')
  })

  // The key only means something while a turn is running with messages
  // waiting behind it. Outside that it is either a no-op or, on a build that
  // predates it, an unbound sequence — so the button must not exist then.
  it.each([
    ['claude, working, one queued', { agent: 'claude', working: true, queued: 1 }, true],
    ['claude, working, several queued', { agent: 'claude', working: true, queued: 3 }, true],
    ['claude, idle', { agent: 'claude', working: false, queued: 2 }, false],
    ['claude, nothing queued', { agent: 'claude', working: true, queued: 0 }, false],
    ['codex has no such key', { agent: 'codex', working: true, queued: 2 }, false],
    ['no agent', { agent: null, working: true, queued: 2 }, false]
  ])('offers it for %s: %s', (_label, state, expected) => {
    expect(canSendQueueNow(state)).toBe(expected)
  })

  it('writes the bytes to the terminal without a trailing Enter', async () => {
    const calls: unknown[] = []
    const client = {
      getState: () => 'connected',
      sendRequest: vi.fn(async (method: string, params: unknown) => {
        calls.push({ method, params })
        return { ok: true, result: { send: { accepted: true } } }
      })
    } as unknown as RpcClient
    expect(await sendClaudeQueueNow({ client, terminal: 'term-1', deviceToken: 'dev-1' })).toBe(
      true
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      method: 'terminal.send',
      params: { terminal: 'term-1', text: CLAUDE_SEND_NOW_BYTES, enter: false }
    })
  })

  // Failure path: the button runs from a tap handler with nowhere for a
  // rejection to go.
  it('reports failure rather than throwing when the host refuses', async () => {
    const client = {
      getState: () => 'connected',
      sendRequest: vi.fn(async () => {
        throw new Error('socket closed')
      })
    } as unknown as RpcClient
    await expect(
      sendClaudeQueueNow({ client, terminal: 'term-1', deviceToken: null })
    ).resolves.toBe(false)
  })

  it('does not write over a link that is down', async () => {
    const send = vi.fn()
    const client = { getState: () => 'connecting', sendRequest: send } as unknown as RpcClient
    expect(await sendClaudeQueueNow({ client, terminal: 'term-1', deviceToken: null })).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })
})
