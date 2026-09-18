import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseAskFromStatus, type AskPrompt } from '../../../src/shared/native-chat-ask'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import {
  acquireMobileNativeChatTerminalWrite,
  isMobileNativeChatTerminalWriteInFlight,
  resetMobileNativeChatTerminalWritesForTests
} from '../session/mobile-native-chat-terminal-write-lock'
import {
  ASK_USER_QUESTION_WHICH_LOGO,
  CODEX_REQUEST_USER_INPUT
} from './ask-user-question-fixtures'
import { sendQuestionAnswerFromNotification } from './question-notification-send'

function ask(input: unknown): AskPrompt {
  const parsed = parseAskFromStatus(JSON.stringify(input))
  if (!parsed) {
    throw new Error('fixture did not parse')
  }
  return parsed
}

type Reply = { ok: boolean; result?: unknown }

/** What the host answers an accepted `terminal.send` with. */
const ACCEPTED: Reply = { ok: true, result: { send: { accepted: true } } }

function makeClient(reply: Reply | (() => Promise<Reply>) = ACCEPTED) {
  const writes: unknown[] = []
  const client = {
    getState: () => 'connected',
    sendRequest: vi.fn(async (method: string, params: unknown) => {
      if (method === 'terminal.send') {
        writes.push(params)
      }
      return typeof reply === 'function' ? reply() : reply
    })
  } as unknown as RpcClient
  return { client, writes }
}

const WHICH_LOGO = ask(ASK_USER_QUESTION_WHICH_LOGO)

/**
 * The keystroke that answers a question from the shade is the same one the
 * chat card writes for the same tap: the option's number, no Enter, built by
 * the shared builder and written through the shared stepper. A second way to
 * turn a pick into bytes is how the two would come to disagree.
 */
describe('writing a question answer from the shade', () => {
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    resetMobileNativeChatTerminalWritesForTests()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    warn.mockRestore()
  })

  it("writes the option's number to the waiting terminal, with no Enter", async () => {
    const { client, writes } = makeClient()
    const sent = await sendQuestionAnswerFromNotification({
      hostId: 'host-1',
      client,
      terminal: 'agent-1',
      agent: 'claude',
      prompt: WHICH_LOGO,
      optionIndex: 1
    })
    expect(sent).toBe(true)
    expect(writes).toEqual([{ terminal: 'agent-1', text: '2', enter: false }])
  })

  it("writes Codex's option number to a Codex terminal", async () => {
    const { client, writes } = makeClient()
    const sent = await sendQuestionAnswerFromNotification({
      hostId: 'host-1',
      client,
      terminal: 'codex-1',
      agent: 'codex',
      prompt: ask(CODEX_REQUEST_USER_INPUT),
      optionIndex: 0
    })
    expect(sent).toBe(true)
    expect(writes).toEqual([{ terminal: 'codex-1', text: '1', enter: false }])
  })

  it('answers OpenClaude with the Claude keystrokes', async () => {
    const { client, writes } = makeClient()
    await sendQuestionAnswerFromNotification({
      hostId: 'host-1',
      client,
      terminal: 'agent-1',
      agent: 'openclaude',
      prompt: WHICH_LOGO,
      optionIndex: 2
    })
    expect(writes).toEqual([{ terminal: 'agent-1', text: '3', enter: false }])
  })

  // Degenerate: the first option is "1", the last of three is "3".
  it.each([
    [0, '1'],
    [2, '3']
  ])('turns pick %i into the digit %s', async (optionIndex, digit) => {
    const { client, writes } = makeClient()
    await sendQuestionAnswerFromNotification({
      hostId: 'host-1',
      client,
      terminal: 'agent-1',
      agent: 'claude',
      prompt: WHICH_LOGO,
      optionIndex
    })
    expect(writes).toEqual([{ terminal: 'agent-1', text: digit, enter: false }])
  })

  /**
   * Grok and OMP commit a pasted LABEL plus Enter, after a clear of whatever
   * is in the composer — a sequence that is only safe with the card's
   * stale-input heal in front of it. The shade has no such thing, so those
   * agents are not answered from it at all. (The banner does not offer them
   * pick buttons either; this is the second fence.)
   */
  it('writes nothing for an agent whose selector cannot be driven by number', async () => {
    const { client, writes } = makeClient()
    const sent = await sendQuestionAnswerFromNotification({
      hostId: 'host-1',
      client,
      terminal: 'grok-1',
      agent: 'grok',
      prompt: WHICH_LOGO,
      optionIndex: 0
    })
    expect(sent).toBe(false)
    expect(writes).toEqual([])
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[question-notification]'),
      expect.objectContaining({ hostId: 'host-1', terminal: 'grok-1', step: 'build-keys' })
    )
  })

  // One composed write per PTY: a digit landing mid-flight in the card's own
  // paced answer or an image paste would interleave bytes.
  it('writes nothing while another composed write holds the terminal', async () => {
    const { client, writes } = makeClient()
    expect(acquireMobileNativeChatTerminalWrite('agent-1')).toBe(true)
    const sent = await sendQuestionAnswerFromNotification({
      hostId: 'host-1',
      client,
      terminal: 'agent-1',
      agent: 'claude',
      prompt: WHICH_LOGO,
      optionIndex: 0
    })
    expect(sent).toBe(false)
    expect(writes).toEqual([])
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[question-notification]'),
      expect.objectContaining({ hostId: 'host-1', terminal: 'agent-1', step: 'lock' })
    )
  })

  it('releases the terminal afterwards, on success and on failure', async () => {
    const ok = makeClient()
    await sendQuestionAnswerFromNotification({
      hostId: 'host-1',
      client: ok.client,
      terminal: 'agent-1',
      agent: 'claude',
      prompt: WHICH_LOGO,
      optionIndex: 0
    })
    expect(isMobileNativeChatTerminalWriteInFlight('agent-1')).toBe(false)

    const refused = makeClient({ ok: false })
    await sendQuestionAnswerFromNotification({
      hostId: 'host-1',
      client: refused.client,
      terminal: 'agent-1',
      agent: 'claude',
      prompt: WHICH_LOGO,
      optionIndex: 0
    })
    expect(isMobileNativeChatTerminalWriteInFlight('agent-1')).toBe(false)
  })

  /**
   * Failure path. If this happens while nobody is watching, the one line it
   * leaves behind has to say where to look: which host, which terminal, and
   * which step of the write did not land.
   */
  it('reports a refused write and says which step, host and terminal', async () => {
    const { client } = makeClient({ ok: false })
    const sent = await sendQuestionAnswerFromNotification({
      hostId: 'host-1',
      client,
      terminal: 'agent-1',
      agent: 'claude',
      prompt: WHICH_LOGO,
      optionIndex: 0
    })
    expect(sent).toBe(false)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[question-notification]'),
      expect.objectContaining({
        hostId: 'host-1',
        terminal: 'agent-1',
        step: 'write 1/1',
        outcome: 'rejected'
      })
    )
  })

  // A lost ack is not a definite non-send: the key may have landed. The
  // caller's re-check makes a retry safe (the prompt is gone once it has), so
  // this is false, but the log must not call it rejected.
  it('reports a lost ack as unconfirmed, not as refused', async () => {
    const { client } = makeClient(async () => {
      throw markRpcDeliveryUnknown(new Error('ack lost'))
    })
    const sent = await sendQuestionAnswerFromNotification({
      hostId: 'host-1',
      client,
      terminal: 'agent-1',
      agent: 'claude',
      prompt: WHICH_LOGO,
      optionIndex: 0
    })
    expect(sent).toBe(false)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[question-notification]'),
      expect.objectContaining({ step: 'write 1/1', outcome: 'unknown' })
    )
  })

  it('does not throw when the request rejects', async () => {
    const { client } = makeClient(async () => {
      throw new Error('socket closed')
    })
    await expect(
      sendQuestionAnswerFromNotification({
        hostId: 'host-1',
        client,
        terminal: 'agent-1',
        agent: 'claude',
        prompt: WHICH_LOGO,
        optionIndex: 0
      })
    ).resolves.toBe(false)
  })
})
