import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import {
  markMobileNativeChatInputStale,
  resetMobileNativeChatStaleInputForTests
} from './mobile-native-chat-stale-input'
import {
  acquireMobileNativeChatTerminalWrite,
  resetMobileNativeChatTerminalWritesForTests
} from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatMessageSend } from './use-mobile-native-chat-message-send'

type Send = ReturnType<typeof useMobileNativeChatMessageSend>

function reply(accepted: boolean) {
  return { id: 'send', ok: true as const, result: { send: { accepted } }, _meta: { runtimeId: 'r' } }
}

/**
 * A session-option pick goes out through `dispatchCommand`. On Claude that is
 * the model and effort rows. On Codex it is only what Codex's own picker
 * driver (use-codex-native-chat-options.ts) does not handle, such as the typed
 * `/model` that opens Codex's model picker; Codex's model and effort picks
 * never come here. The picker stays open on a false result with nothing
 * else to say why, so a refusal that is not reported leaves a row that looks
 * tappable and does nothing. Found by the sweep after the Stop fix
 * (2026-09-25): the write-lock exit (every agent) and each of Codex's exits
 * (not ready, a refused clear, refused or ack-lost keys) returned without a
 * word, while Claude's, which go through the composer's own send, already
 * said "Message not sent". The same send said nothing for a slash command
 * whose ack was lost either: a chat message waits for its transcript echo
 * before it says so, and a command has no echo.
 */
describe('a session-option pick or slash command that did not go out says so', () => {
  let renderer: ReactTestRenderer | null = null
  let api: Send | null = null
  let onSendError = vi.fn()
  let holdUnconfirmedSend = vi.fn()
  let sendRequest = vi.fn()

  beforeEach(() => {
    onSendError = vi.fn()
    holdUnconfirmedSend = vi.fn()
    sendRequest = vi.fn(async () => reply(true))
    resetMobileNativeChatTerminalWritesForTests()
    resetMobileNativeChatStaleInputForTests()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    api = null
  })

  function mount(agent: string, enabled = true): void {
    function Probe(): null {
      api = useMobileNativeChatMessageSend({
        client: {
          sendRequest,
          getState: () => 'connected',
          notifyForeground: () => undefined
        } as unknown as RpcClient,
        enabled,
        handleRef: { current: 'term' },
        deviceTokenRef: { current: 'device' },
        agentRef: { current: agent },
        commandSendRef: { current: () => undefined },
        captureSendOrigin: () => ({ draftKey: 'k', pendingKey: 'p' }) as never,
        readSeededLaunchDraftSeed: () => null,
        clearDraftForSend: () => undefined,
        restoreRejectedDraft: () => undefined,
        acceptSend: () => undefined,
        holdUnconfirmedSend,
        onSendError
      })
      return null
    }
    act(() => {
      renderer = create(createElement(Probe))
    })
  }

  async function pick(command: string): Promise<string | undefined> {
    let outcome: string | undefined
    await act(async () => {
      outcome = await api!.dispatchCommand(command)
    })
    return outcome
  }

  it.each(['claude', 'codex'])(
    'says a %s session command was not sent while another input holds the terminal',
    async (agent) => {
      mount(agent)
      // An image paste or a paced answer is mid-way through its writes.
      expect(acquireMobileNativeChatTerminalWrite('term')).toBe(true)

      expect(await pick('/model')).toBe('rejected')
      expect(sendRequest).not.toHaveBeenCalled()
      expect(onSendError).toHaveBeenCalledTimes(1)
      expect(onSendError).toHaveBeenCalledWith('Another input is still being sent. Try again.')
    }
  )

  // The link is up and the input lease is not: the reason names that, rather
  // than the bare "(disconnected)" every refusal once said (2026-09-25).
  it('says a Codex picker command was not sent while the terminal is not taking input', async () => {
    mount('codex', false)

    expect(await pick('/model')).toBe('rejected')
    expect(sendRequest).not.toHaveBeenCalled()
    expect(onSendError).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledWith(
      'Command not sent: the desktop terminal is not taking input from this phone yet'
    )
  })

  it('says a Codex picker command was not sent when the host refuses its keys', async () => {
    sendRequest.mockResolvedValue(reply(false))
    mount('codex')

    expect(await pick('/model')).toBe('rejected')
    // The first key, the line clear, was refused; nothing after it went out.
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledWith('Message not sent')
  })

  it('says a Codex picker command is unconfirmed when the ack of its keys is lost', async () => {
    sendRequest.mockRejectedValue(markRpcDeliveryUnknown(new Error('Connection closed')))
    mount('codex')

    expect(await pick('/model')).toBe('unknown')
    expect(onSendError).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledWith('Command unconfirmed — check chat before retrying')
  })

  it('says a Codex picker command was not sent when the clear before it is refused', async () => {
    // An earlier image paste failed, so the line must be cleared first.
    markMobileNativeChatInputStale('term')
    sendRequest.mockResolvedValue(reply(false))
    mount('codex')

    expect(await pick('/model')).toBe('rejected')
    expect(onSendError).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledWith('Message not sent')
  })

  it('says a Claude model pick is unconfirmed when its ack is lost', async () => {
    mount('claude')
    // The line clear lands; the command's own write loses its ack.
    sendRequest
      .mockResolvedValueOnce(reply(true))
      .mockRejectedValue(markRpcDeliveryUnknown(new Error('Connection closed')))

    expect(await pick('/model sonnet')).toBe('unknown')
    expect(onSendError).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledWith('Command unconfirmed — check chat before retrying')
  })

  it('says a slash command sent from the composer is unconfirmed when its ack is lost', async () => {
    mount('claude')
    // The line clear lands; the command's own write loses its ack.
    sendRequest
      .mockResolvedValueOnce(reply(true))
      .mockRejectedValue(markRpcDeliveryUnknown(new Error('Connection closed')))

    let sent: boolean | undefined
    await act(async () => {
      sent = await api!.send('/clear')
    })

    // Still "sent" to the composer (it usually landed), but no longer silent.
    expect(sent).toBe(true)
    expect(holdUnconfirmedSend).not.toHaveBeenCalled()
    expect(onSendError).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledWith('Command unconfirmed — check chat before retrying')
  })

  it('holds the terminal for a Codex picker command until its last key is written', async () => {
    const settle: Array<(value: unknown) => void> = []
    sendRequest.mockImplementation(() => new Promise((resolve) => settle.push(resolve)))
    mount('codex')

    let picked: Promise<string> | undefined
    act(() => {
      picked = api!.dispatchCommand('/model')
    })
    await vi.waitFor(() => expect(settle).toHaveLength(1))
    // A composer send now would splice its bytes into the command being typed.
    expect(acquireMobileNativeChatTerminalWrite('term')).toBe(false)
    let done = false
    void picked!.then(() => {
      done = true
    })
    // Let each key land in turn: the line clear, the command's six, Enter.
    await act(async () => {
      while (!done) {
        await vi.waitFor(() => expect(settle.length > 0 || done).toBe(true))
        settle.shift()?.(reply(true))
      }
    })
    await expect(picked).resolves.toBe('accepted')
    expect(sendRequest).toHaveBeenCalledTimes(8)
    expect(acquireMobileNativeChatTerminalWrite('term')).toBe(true)
  })

  it('stays quiet when a Codex picker command lands', async () => {
    mount('codex')

    expect(await pick('/model')).toBe('accepted')
    expect(onSendError).not.toHaveBeenCalled()
  })

  it('leaves a chat message whose ack is lost to its transcript echo', async () => {
    mount('claude')
    sendRequest
      .mockResolvedValueOnce(reply(true))
      .mockRejectedValue(markRpcDeliveryUnknown(new Error('Connection closed')))

    await act(async () => {
      await api!.send('hello there')
    })

    // The echo usually arrives; only its absence says "unconfirmed".
    expect(holdUnconfirmedSend).toHaveBeenCalledTimes(1)
    expect(onSendError).not.toHaveBeenCalled()
  })
})
