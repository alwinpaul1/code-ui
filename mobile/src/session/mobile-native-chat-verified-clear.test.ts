import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { createFakeComposerHost } from './fake-claude-composer-host.test-support'
import { buildMobileNativeChatClearInputOneRead } from './mobile-native-chat-input-clear'
import { clearClaudeInputVerified, CLEAR_SETTLE_MS } from './mobile-native-chat-verified-clear'

// Claude Code 2.1.287 turns a control byte into a key only when the whole stdin
// READ is under 64 bytes, and writes made back to back are one read. The stand-in
// input (fake-claude-composer-host.test-support.ts) models that rule, so a clear
// that coalesces comes back as text on the next look.

const accepted = { id: 'r', ok: true, result: { send: { accepted: true } }, _meta: { runtimeId: 'rt' } }
const noSettle = () => Promise.resolve()
type Host = ReturnType<typeof createFakeComposerHost>
const clientOf = (host: Host): RpcClient => ({ sendRequest: host.handle }) as unknown as RpcClient
const clearArgs = (host: Host, believedTexts: readonly (string | null)[] = ['hello']) => ({
  client: clientOf(host),
  terminal: 'term',
  believedTexts,
  settle: noSettle
})
const clearWrites = (host: Host) => host.sends.filter((write) => !write.enter).map((write) => write.text)
const methods = (host: Host) => host.handle.mock.calls.map(([method]) => method)

/** A client for a screen that cannot be read: writes go through, every look fails. */
function clientWithoutScreen(failure: () => Promise<unknown>) {
  const writes: string[] = []
  const sendRequest = vi.fn(async (method: string, params: unknown) => {
    if (method === 'terminal.send') {
      writes.push((params as { text: string }).text)
      return accepted
    }
    return failure()
  })
  return { client: { sendRequest } as unknown as RpcClient, writes, sendRequest }
}

describe('clearing Claude Code\'s input and proving it empty', () => {
  it('looks, sends ONE write under 64 bytes, looks again, and only then reports it clear', async () => {
    const host = createFakeComposerHost()
    host.holdInput('x'.repeat(176))

    await expect(clearClaudeInputVerified(clearArgs(host, ['x'.repeat(176)]))).resolves.toBe('cleared')

    expect(methods(host)).toEqual(['terminal.read', 'terminal.send', 'terminal.read'])
    expect(clearWrites(host)).toHaveLength(1)
    expect(clearWrites(host)[0]!.length).toBeLessThan(64)
    expect(host.input).toBe('')
  })

  it('is not fooled by the control bytes becoming text: the look after the clear still sees them', async () => {
    // The 2026-10-01 symptom on a host where the clear cannot work: nothing but a
    // look tells it, and the caller must not type the body after it.
    const host = createFakeComposerHost({ controlsAreLiteral: true })
    host.holdInput('some words')

    await expect(clearClaudeInputVerified(clearArgs(host))).resolves.toBe('still-holds')

    // One clear, a look, one more clear, a look: then it stops.
    expect(methods(host)).toEqual(['terminal.read', 'terminal.send', 'terminal.read', 'terminal.send', 'terminal.read'])
    expect(host.sends.some((write) => write.enter)).toBe(false)
  })

  it('clears a second time from what the look shows, and reports it clear', async () => {
    const host = createFakeComposerHost({ columns: 50 })
    host.holdInput('long '.repeat(400))

    await expect(clearClaudeInputVerified(clearArgs(host))).resolves.toBe('cleared')

    expect(clearWrites(host).length).toBeGreaterThanOrEqual(2)
    expect(clearWrites(host).every((text) => text.length < 64)).toBe(true)
    expect(host.input).toBe('')
  })

  it('clears an input too tall for two passes only as far as it can, and refuses', async () => {
    // 3000 rows: 2 writes of 62 bytes cannot reach them, and it does not loop.
    const host = createFakeComposerHost({ columns: 12 })
    host.holdInput('word '.repeat(6000))

    await expect(clearClaudeInputVerified(clearArgs(host))).resolves.toBe('still-holds')

    expect(clearWrites(host)).toHaveLength(2)
  })

  it('writes nothing and reports clear when the input is empty and nothing is believed on it', async () => {
    const host = createFakeComposerHost()

    await expect(clearClaudeInputVerified(clearArgs(host, [null, '', undefined as never]))).resolves.toBe('cleared')

    expect(host.sends).toEqual([])
    expect(host.reads).toBe(1)
  })

  it('still clears one row of an empty-looking input the phone believes it typed (the keys may be on their way)', async () => {
    const host = createFakeComposerHost()

    await expect(clearClaudeInputVerified(clearArgs(host, ['hello']))).resolves.toBe('cleared')

    expect(clearWrites(host)).toHaveLength(1)
    expect(clearWrites(host)[0]!.length).toBeLessThan(20)
  })

  it('clears a one-character input', async () => {
    const host = createFakeComposerHost({ publishes: 'tail' })
    host.holdInput('y')

    await expect(clearClaudeInputVerified(clearArgs(host, ['y']))).resolves.toBe('cleared')
    expect(host.input).toBe('')
  })

  it('waits between the clear and the look that checks it', async () => {
    const host = createFakeComposerHost()
    host.holdInput('abc')
    const settle = vi.fn(() => Promise.resolve())

    await clearClaudeInputVerified({ ...clearArgs(host), settle })

    expect(settle).toHaveBeenCalledWith(CLEAR_SETTLE_MS)
  })

  describe('when the screen cannot be read', () => {
    const cases: Array<[string, () => Promise<unknown>]> = [
      ['the RPC is rejected', () => Promise.reject(new Error('disconnected'))],
      ['the read times out', () => Promise.reject(new Error('Request timed out'))],
      [
        'an older host answers with the stream, not the screen',
        () => Promise.resolve({ id: 'r', ok: true, result: { terminal: { source: 'stream', tail: ['x'] } } })
      ],
      ['the reply is not a screen', () => Promise.resolve({ id: 'r', ok: true, result: { terminal: {} } })],
      ['the host refuses the read', () => Promise.resolve({ id: 'r', ok: false, error: { code: 'x', message: 'no' } })]
    ]
    for (const [name, failure] of cases) {
      it(`sends the text-sized clear as ONE write and calls it unverified when ${name}`, async () => {
        const { client, writes } = clientWithoutScreen(failure)
        const text = 'a long draft '.repeat(40)

        await expect(clearClaudeInputVerified({ client, terminal: 'term', believedTexts: [text], settle: noSettle })).resolves.toBe(
          'unverified'
        )

        expect(writes).toEqual([buildMobileNativeChatClearInputOneRead(text)])
        expect(writes[0]!.length).toBeLessThan(64)
      })
    }
  })

  it('goes on when only the look AFTER the clear fails, and calls it unverified', async () => {
    const host = createFakeComposerHost()
    host.holdInput('abc')
    let reads = 0
    const base = host.handle.getMockImplementation()!
    host.handle.mockImplementation(async (method: string, params: unknown) => {
      if (method === 'terminal.read' && ++reads === 2) {
        throw new Error('Request timed out')
      }
      return base(method, params)
    })

    await expect(clearClaudeInputVerified(clearArgs(host))).resolves.toBe('unverified')
  })

  it('calls it unverified, after one write, when a dialog stands where the composer should be', async () => {
    const { client, writes } = clientWithoutScreen(() =>
      Promise.resolve({
        id: 'r',
        ok: true,
        result: { terminal: { source: 'screen', tail: ['⏺ Bash(ls)', '  Do you want to proceed?', '❯ 1. Yes', '  2. No', '  Esc to cancel'] } }
      })
    )

    await expect(clearClaudeInputVerified({ client, terminal: 'term', believedTexts: ['hello'], settle: noSettle })).resolves.toBe(
      'unverified'
    )

    expect(writes).toHaveLength(1)
  })

  it('reports a refused clear write as failed and writes nothing more', async () => {
    const host = createFakeComposerHost()
    host.holdInput('abc')
    const base = host.handle.getMockImplementation()!
    host.handle.mockImplementation(async (method: string, params: unknown) =>
      method === 'terminal.send'
        ? { id: 'r', ok: true, result: { send: { accepted: false } }, _meta: { runtimeId: 'rt' } }
        : base(method, params)
    )

    await expect(clearClaudeInputVerified(clearArgs(host))).resolves.toBe('write-failed')
    expect(methods(host)).toEqual(['terminal.read', 'terminal.send'])
  })

  it('writes nothing once the send budget is spent', async () => {
    const host = createFakeComposerHost()
    host.holdInput('abc')

    await expect(
      clearClaudeInputVerified({ ...clearArgs(host), deadline: Date.now() - 1 })
    ).resolves.toBe('write-failed')
    expect(host.sends).toEqual([])
  })
})
