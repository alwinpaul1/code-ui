import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { dispatchMobileStructuredCommand } from './mobile-structured-composer-command'

function setup() {
  const sendRequest = vi.fn(async (_method: string, _params: unknown, _options: unknown) => ({
    ok: true,
    result: { ok: true, value: { command: 'compact', state: 'completed' } }
  }))
  const input: Parameters<typeof dispatchMobileStructuredCommand>[0] = {
    text: '/compact',
    hasAttachments: false,
    client: { sendRequest } as unknown as RpcClient,
    sessionId: 'session',
    fence: 1,
    sessionKey: 'session:1',
    pending: { current: false },
    operationIds: new Map(),
    // A host the probe has not answered for keeps the replay these cases pin; the 1.4.220 host's
    // fresh id per press is in mobile-structured-press-own-action.test.ts.
    hostAnswersRepeats: null,
    controller: {
      agent: 'codex',
      snapshot: [],
      invokeAction: vi.fn(async () => true),
      setOption: vi.fn(async () => true),
      conversationCommands: ['clear', 'compact']
    },
    busy: () => null,
    onError: vi.fn(),
    timeoutMs: 15000
  }
  return { input, sendRequest }
}
describe('mobile structured conversation commands', () => {
  it.each(['/clear', '/compact'])(
    'uses the command RPC for %s without an ordinary send',
    async (text) => {
      const { input, sendRequest } = setup()
      expect(await dispatchMobileStructuredCommand({ ...input, text })).toBe('accepted')
      expect(sendRequest).toHaveBeenCalledWith(
        'agentSession.conversationCommand',
        expect.objectContaining({ command: text.slice(1) }),
        expect.anything()
      )
      expect(input.operationIds.size).toBe(0)
    }
  )
  it('retains the exact operation ID after an unknown response', async () => {
    const { input, sendRequest } = setup()
    sendRequest.mockResolvedValueOnce({
      ok: true,
      result: { ok: true, value: { command: 'compact', state: 'unknown' } }
    })
    expect(await dispatchMobileStructuredCommand(input)).toBe('unknown')
    expect(await dispatchMobileStructuredCommand(input)).toBe('accepted')
    expect(sendRequest.mock.calls[0]?.[1]).toEqual(sendRequest.mock.calls[1]?.[1])
  })
  it('retains operation identity when the host explicitly reports an unknown ledger outcome', async () => {
    const { input, sendRequest } = setup()
    sendRequest.mockResolvedValueOnce({
      ok: true,
      result: {
        ok: false,
        refusal: { code: 'agent_session_operation_unknown', message: 'unconfirmed' }
      }
    } as never)
    expect(await dispatchMobileStructuredCommand(input)).toBe('unknown')
    expect(await dispatchMobileStructuredCommand(input)).toBe('accepted')
    expect(sendRequest.mock.calls[0]?.[1]).toEqual(sendRequest.mock.calls[1]?.[1])
  })
  it('retains operation identity when the host fails after starting the command', async () => {
    const { input, sendRequest } = setup()
    sendRequest.mockResolvedValueOnce({
      ok: false,
      error: { code: 'runtime_error', message: 'settlement failed' }
    } as never)
    expect(await dispatchMobileStructuredCommand(input)).toBe('unknown')
    expect(await dispatchMobileStructuredCommand(input)).toBe('accepted')
    expect(sendRequest.mock.calls[0]?.[1]).toEqual(sendRequest.mock.calls[1]?.[1])
  })
  it.each(['attachments', 'old host', 'arguments', 'pending work'])(
    'guards %s without provider dispatch',
    async (reason) => {
      const { input, sendRequest } = setup()
      if (reason === 'attachments') {
        input.hasAttachments = true
      }
      if (reason === 'old host') {
        input.controller.conversationCommands = undefined
      }
      if (reason === 'arguments') {
        input.text = '/compact instructions'
      }
      if (reason === 'pending work') {
        input.busy = () => 'working'
      }
      expect(await dispatchMobileStructuredCommand(input)).toBe('rejected')
      expect(sendRequest).not.toHaveBeenCalled()
      expect(input.onError).toHaveBeenCalled()
    }
  )
  // Orca #25704: the phone's own check says what the person sees and can do, in the desktop's
  // words, and names the cause so its line goes when that ends. Before, every case read "Wait for
  // pending work to finish before using this command."
  it('a /clear while the agent works says so in plain words', async () => {
    const { input, sendRequest } = setup()
    input.busy = () => 'working'
    expect(await dispatchMobileStructuredCommand({ ...input, text: '/clear' })).toBe('rejected')
    expect(input.onError).toHaveBeenLastCalledWith(
      "The agent is still working. Run /clear when it's done.",
      { refusedWhile: 'working' }
    )
    input.busy = () => 'prompt'
    expect(await dispatchMobileStructuredCommand({ ...input, text: '/clear' })).toBe('rejected')
    expect(input.onError).toHaveBeenLastCalledWith(
      "Answer the agent's question or approval, then run /clear.",
      { refusedWhile: 'prompt' }
    )
    input.busy = () => 'working'
    expect(await dispatchMobileStructuredCommand(input)).toBe('rejected')
    expect(input.onError).toHaveBeenLastCalledWith(
      "The agent is still working. Run /compact when it's done.",
      { refusedWhile: 'working' }
    )
    expect(sendRequest).not.toHaveBeenCalled()
  })
  it("a host's refusal sentence is shown as sent, naming no cause the phone did not check", async () => {
    const { input, sendRequest } = setup()
    sendRequest.mockResolvedValueOnce({
      ok: true,
      result: {
        ok: true,
        value: {
          command: 'compact',
          state: 'completed',
          error: "The agent is still working. Run /compact when it's done."
        }
      }
    } as never)
    expect(await dispatchMobileStructuredCommand(input)).toBe('rejected')
    expect(input.onError).toHaveBeenLastCalledWith(
      "The agent is still working. Run /compact when it's done.",
      undefined
    )
  })
  it('lets /init reach Claude instead of answering "not available in chat sessions"', async () => {
    // Claude's own harness expands a slash command out of the message body, so
    // the host never had a way to run `/init` — claiming it only produced a
    // refusal for a command Claude does carry out.
    const { input, sendRequest } = setup()
    input.controller.agent = 'claude'
    expect(await dispatchMobileStructuredCommand({ ...input, text: '/init' })).toBeNull()
    expect(sendRequest).not.toHaveBeenCalled()
    expect(input.onError).not.toHaveBeenCalled()
  })

  it('lets /goal reach Codex, whose model runs it through its own goal tools', async () => {
    const { input, sendRequest } = setup()
    expect(
      await dispatchMobileStructuredCommand({ ...input, text: '/goal ship the release' })
    ).toBeNull()
    expect(sendRequest).not.toHaveBeenCalled()
    expect(input.onError).not.toHaveBeenCalled()
  })

  it.each(['codex', 'claude'])(
    'still claims /clear for %s so a hand-typed one never reaches the model as text',
    async (agent) => {
      const { input } = setup()
      input.controller.agent = agent
      expect(await dispatchMobileStructuredCommand({ ...input, text: '/clear' })).toBe('accepted')
    }
  )

  it('keeps ordinary messages on the existing send path', async () => {
    const { input, sendRequest } = setup()
    expect(await dispatchMobileStructuredCommand({ ...input, text: 'hello' })).toBeNull()
    expect(sendRequest).not.toHaveBeenCalled()
  })
})
