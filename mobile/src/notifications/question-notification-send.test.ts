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
  ASK_USER_QUESTION_CLEANUP,
  ASK_USER_QUESTION_STACK_AND_LOOK,
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
      selections: [{ indices: [1] }]
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
      selections: [{ indices: [0] }]
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
      selections: [{ indices: [2] }]
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
      selections: [{ indices: [optionIndex] }]
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
      selections: [{ indices: [0] }]
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
      selections: [{ indices: [0] }]
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
      selections: [{ indices: [0] }]
    })
    expect(isMobileNativeChatTerminalWriteInFlight('agent-1')).toBe(false)

    const refused = makeClient({ ok: false })
    await sendQuestionAnswerFromNotification({
      hostId: 'host-1',
      client: refused.client,
      terminal: 'agent-1',
      agent: 'claude',
      prompt: WHICH_LOGO,
      selections: [{ indices: [0] }]
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
      selections: [{ indices: [0] }]
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
      selections: [{ indices: [0] }]
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
        selections: [{ indices: [0] }]
      })
    ).resolves.toBe(false)
  })

  /**
   * A typed reply is several keystrokes: the "Type something" row's number,
   * the text, Enter — and for a multi-select, one digit per pick then the
   * step to Submit. They go through the shared stepper a step apart, exactly
   * as the card writes them. Fake timers stand in for the pacing.
   */
  describe('a typed reply', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    async function settle<T>(promise: Promise<T>): Promise<T> {
      await vi.runAllTimersAsync()
      return promise
    }

    it("writes an Other answer as the free-text row's number, the text, then Enter", async () => {
      const { client, writes } = makeClient()
      const sent = await settle(
        sendQuestionAnswerFromNotification({
          hostId: 'host-1',
          client,
          terminal: 'agent-1',
          agent: 'claude',
          prompt: WHICH_LOGO,
          selections: [{ indices: [], other: 'none of these, keep the red' }]
        })
      )
      expect(sent).toBe(true)
      expect(writes).toEqual([
        { terminal: 'agent-1', text: '4', enter: false },
        { terminal: 'agent-1', text: 'none of these, keep the red', enter: false },
        { terminal: 'agent-1', text: '\r', enter: false }
      ])
    })

    // The text is typed as raw keystrokes into the selector's input; a line
    // break there would submit early. Same sanitizer as the card.
    it('collapses line breaks in the typed text', async () => {
      const { client, writes } = makeClient()
      await settle(
        sendQuestionAnswerFromNotification({
          hostId: 'host-1',
          client,
          terminal: 'agent-1',
          agent: 'claude',
          prompt: WHICH_LOGO,
          selections: [{ indices: [], other: 'first line\r\nsecond line' }]
        })
      )
      expect(writes[1]).toEqual({ terminal: 'agent-1', text: 'first line second line', enter: false })
    })

    it('toggles each picked number of a multi-select, then steps to Submit and confirms', async () => {
      const { client, writes } = makeClient()
      await settle(
        sendQuestionAnswerFromNotification({
          hostId: 'host-1',
          client,
          terminal: 'agent-1',
          agent: 'claude',
          prompt: ask(ASK_USER_QUESTION_CLEANUP),
          selections: [{ indices: [0, 2] }]
        })
      )
      expect(writes.map((w) => (w as { text: string }).text)).toEqual(['1', '3', '\x1b[C', '\r'])
    })

    it('answers two questions in order and confirms once', async () => {
      const { client, writes } = makeClient()
      await settle(
        sendQuestionAnswerFromNotification({
          hostId: 'host-1',
          client,
          terminal: 'agent-1',
          agent: 'claude',
          prompt: ask(ASK_USER_QUESTION_STACK_AND_LOOK),
          selections: [{ indices: [1] }, { indices: [2] }]
        })
      )
      expect(writes.map((w) => (w as { text: string }).text)).toEqual(['2', '3', '\r'])
    })

    it('writes nothing for a selection with no answer in it', async () => {
      const { client, writes } = makeClient()
      const sent = await settle(
        sendQuestionAnswerFromNotification({
          hostId: 'host-1',
          client,
          terminal: 'agent-1',
          agent: 'claude',
          prompt: WHICH_LOGO,
          selections: [{ indices: [] }]
        })
      )
      expect(sent).toBe(false)
      expect(writes).toEqual([])
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('[question-notification]'),
        expect.objectContaining({ hostId: 'host-1', terminal: 'agent-1', step: 'build-keys' })
      )
    })

    // Failure mid-sequence: the row number landed, the text did not. The log
    // says which step, because a retry from scratch would type the row number
    // into the now-open text field.
    it('names the step that failed in a multi-step reply', async () => {
      let calls = 0
      const { client } = makeClient(async () => {
        calls += 1
        return calls === 1 ? ACCEPTED : { ok: false }
      })
      const sent = await settle(
        sendQuestionAnswerFromNotification({
          hostId: 'host-1',
          client,
          terminal: 'agent-1',
          agent: 'claude',
          prompt: WHICH_LOGO,
          selections: [{ indices: [], other: 'keep the red' }]
        })
      )
      expect(sent).toBe(false)
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('[question-notification]'),
        expect.objectContaining({ step: 'write 2/3', outcome: 'rejected' })
      )
    })
  })

  /**
   * A half-written reply. The row digit landed and the text did not, so the
   * agent's selector now sits on its open text row — and the prompt is still
   * pending, still 'waiting', same key, so the stale check lets a second tap
   * straight through. A from-scratch retry would type the row digit INTO the
   * text field ("4keep the red"), and for a multi-select it would toggle the
   * first box back OFF and submit the rest (review finding F4, 2026-09-18).
   * The terminal has to remember it was left half-stepped, and refuse until
   * the agent is asking something else.
   */
  describe('after a reply was only half written', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    async function settle<T>(promise: Promise<T>): Promise<T> {
      await vi.runAllTimersAsync()
      return promise
    }

    function acceptsThenRejects(acceptedWrites: number) {
      let calls = 0
      return makeClient(async () => {
        calls += 1
        return calls <= acceptedWrites ? ACCEPTED : { ok: false }
      })
    }

    const OTHER = [{ indices: [], other: 'keep the red' }]

    it('refuses to retry an Other answer whose row digit landed, writing nothing', async () => {
      const first = acceptsThenRejects(1)
      expect(
        await settle(
          sendQuestionAnswerFromNotification({
            hostId: 'host-1',
            client: first.client,
            terminal: 'agent-1',
            agent: 'claude',
            prompt: WHICH_LOGO,
            selections: OTHER
          })
        )
      ).toBe(false)

      const retry = makeClient()
      expect(
        await settle(
          sendQuestionAnswerFromNotification({
            hostId: 'host-1',
            client: retry.client,
            terminal: 'agent-1',
            agent: 'claude',
            prompt: WHICH_LOGO,
            selections: OTHER
          })
        )
      ).toBe(false)
      expect(retry.writes).toEqual([])
      expect(warn).toHaveBeenLastCalledWith(
        expect.stringContaining('[question-notification]'),
        expect.objectContaining({
          hostId: 'host-1',
          terminal: 'agent-1',
          step: 'half-stepped',
          outcome: expect.stringContaining('2/3')
        })
      )
    })

    it('refuses to retry a multi-select whose first toggles landed', async () => {
      const first = acceptsThenRejects(2)
      await settle(
        sendQuestionAnswerFromNotification({
          hostId: 'host-1',
          client: first.client,
          terminal: 'agent-1',
          agent: 'claude',
          prompt: ask(ASK_USER_QUESTION_CLEANUP),
          selections: [{ indices: [0, 2] }]
        })
      )
      const retry = makeClient()
      expect(
        await settle(
          sendQuestionAnswerFromNotification({
            hostId: 'host-1',
            client: retry.client,
            terminal: 'agent-1',
            agent: 'claude',
            prompt: ask(ASK_USER_QUESTION_CLEANUP),
            selections: [{ indices: [0, 2] }]
          })
        )
      ).toBe(false)
      expect(retry.writes).toEqual([])
    })

    // A lost ack on the FIRST step of a multi-step plan is the same hazard:
    // the digit may have landed. (A one-step plan stays retryable: the
    // caller's re-check finds no prompt once it has.)
    it('treats a lost ack inside a multi-step reply as half written', async () => {
      const first = makeClient(async () => {
        throw markRpcDeliveryUnknown(new Error('ack lost'))
      })
      await settle(
        sendQuestionAnswerFromNotification({
          hostId: 'host-1',
          client: first.client,
          terminal: 'agent-1',
          agent: 'claude',
          prompt: WHICH_LOGO,
          selections: OTHER
        })
      )
      const retry = makeClient()
      expect(
        await settle(
          sendQuestionAnswerFromNotification({
            hostId: 'host-1',
            client: retry.client,
            terminal: 'agent-1',
            agent: 'claude',
            prompt: WHICH_LOGO,
            selections: OTHER
          })
        )
      ).toBe(false)
      expect(retry.writes).toEqual([])
    })

    it('still retries a one-keystroke pick after a lost ack', async () => {
      const first = makeClient(async () => {
        throw markRpcDeliveryUnknown(new Error('ack lost'))
      })
      await settle(
        sendQuestionAnswerFromNotification({
          hostId: 'host-1',
          client: first.client,
          terminal: 'agent-1',
          agent: 'claude',
          prompt: WHICH_LOGO,
          selections: [{ indices: [1] }]
        })
      )
      const retry = makeClient()
      expect(
        await settle(
          sendQuestionAnswerFromNotification({
            hostId: 'host-1',
            client: retry.client,
            terminal: 'agent-1',
            agent: 'claude',
            prompt: WHICH_LOGO,
            selections: [{ indices: [1] }]
          })
        )
      ).toBe(true)
      expect(retry.writes).toEqual([{ terminal: 'agent-1', text: '2', enter: false }])
    })

    // A refusal on the very first write leaves the selector untouched.
    it('retries freely when nothing at all landed', async () => {
      const first = makeClient({ ok: false })
      await settle(
        sendQuestionAnswerFromNotification({
          hostId: 'host-1',
          client: first.client,
          terminal: 'agent-1',
          agent: 'claude',
          prompt: WHICH_LOGO,
          selections: OTHER
        })
      )
      const retry = makeClient()
      expect(
        await settle(
          sendQuestionAnswerFromNotification({
            hostId: 'host-1',
            client: retry.client,
            terminal: 'agent-1',
            agent: 'claude',
            prompt: WHICH_LOGO,
            selections: OTHER
          })
        )
      ).toBe(true)
      expect(retry.writes).toHaveLength(3)
    })

    // The mark is for THAT prompt on THAT terminal: once the agent is asking
    // something else, the selector has been redrawn and the shade may write.
    it('lets a different question through on the same terminal', async () => {
      const first = acceptsThenRejects(1)
      await settle(
        sendQuestionAnswerFromNotification({
          hostId: 'host-1',
          client: first.client,
          terminal: 'agent-1',
          agent: 'claude',
          prompt: WHICH_LOGO,
          selections: OTHER
        })
      )
      const next = makeClient()
      expect(
        await settle(
          sendQuestionAnswerFromNotification({
            hostId: 'host-1',
            client: next.client,
            terminal: 'agent-1',
            agent: 'claude',
            prompt: ask(CODEX_REQUEST_USER_INPUT),
            selections: [{ indices: [0] }]
          })
        )
      ).toBe(true)
      expect(next.writes).toEqual([{ terminal: 'agent-1', text: '1', enter: false }])
    })

    it('keeps the mark to the terminal it was left on', async () => {
      const first = acceptsThenRejects(1)
      await settle(
        sendQuestionAnswerFromNotification({
          hostId: 'host-1',
          client: first.client,
          terminal: 'agent-1',
          agent: 'claude',
          prompt: WHICH_LOGO,
          selections: OTHER
        })
      )
      const other = makeClient()
      expect(
        await settle(
          sendQuestionAnswerFromNotification({
            hostId: 'host-1',
            client: other.client,
            terminal: 'agent-2',
            agent: 'claude',
            prompt: WHICH_LOGO,
            selections: OTHER
          })
        )
      ).toBe(true)
      expect(other.writes).toHaveLength(3)
    })
  })
})
