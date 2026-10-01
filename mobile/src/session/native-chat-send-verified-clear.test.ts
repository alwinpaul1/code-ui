// The send, end to end, against a stand-in for Claude Code's input
// (fake-claude-composer-host.test-support.ts), with the real send hook and no
// mock of the write path.
//
// Reported 2026-10-01: a 176-character single-line message sent from the chat
// was drawn as sent, the desktop input still held it unsent, and when it was
// submitted Claude received the message, 33 newlines and the message again.
// The phone had sized the clear at 20 columns a line (9 lines + 8 slack), cut
// the 66 control bytes into writes of 63 and 3, and sent the body straight
// after. Claude Code 2.1.287 turns a control byte into a key only when the
// whole stdin READ is under 64 bytes, and writes made back to back are one
// read, so all 66 bytes went into the input as text. On Enter Claude stripped
// them, and because it had removed something it did not submit: "Removed 67
// invisible characters · review and press Enter to send".

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeComposerHost,
  type FakeComposerHost
} from './fake-claude-composer-host.test-support'
import { useMobileNativeChatMessageSend } from './use-mobile-native-chat-message-send'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import type { BeaconPromptReceipt } from './mobile-native-chat-beacon-confirm'
import type { RpcClient } from '../transport/rpc-client'

vi.mock('./mobile-native-chat-stale-input', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mobile-native-chat-stale-input')>()),
  healMobileNativeChatStaleInput: () => Promise.resolve(true)
}))

const clientOf = (host: FakeComposerHost): RpcClient =>
  ({
    sendRequest: host.handle,
    getState: () => 'connected',
    notifyForeground: vi.fn()
  }) as unknown as RpcClient

/** 176 characters, one line, as in the report (the words are stand-ins). */
const MESSAGE = '! sudo pfctl -a com.apple/anchor-v6 -F all; sudo pfctl -X 1111111111111111111; '
  .repeat(3)
  .slice(0, 176)
const STILL_HOLDS = 'The desktop input still holds text. Clear it there, then send again.'

describe('a message sent from the chat while the desktop input holds a copy of it', () => {
  let renderer: ReactTestRenderer | null = null
  let api: ReturnType<typeof useMobileNativeChatMessageSend> | null = null
  const acceptSend = vi.fn()
  const clearDraftForSend = vi.fn()
  const restoreRejectedDraft = vi.fn()
  const holdUnconfirmedSend = vi.fn()
  let report = vi.fn()

  const mount = (
    host: FakeComposerHost,
    agent: string | null = 'claude',
    promptReceipts: readonly BeaconPromptReceipt[] = []
  ): void => {
    function Probe(): null {
      api = useMobileNativeChatMessageSend({
        client: clientOf(host),
        enabled: true,
        handleRef: { current: 'term' },
        deviceTokenRef: { current: 'device' },
        agentRef: { current: agent },
        commandSendRef: { current: vi.fn() },
        captureSendOrigin: () => ({ draftKey: 'k', pendingKey: 'p' }) as never,
        readSeededLaunchDraftSeed: () => null,
        clearDraftForSend,
        restoreRejectedDraft,
        acceptSend,
        holdUnconfirmedSend,
        onSendError: report,
        promptReceipts
      })
      return null
    }
    act(() => {
      renderer = create(createElement(Probe))
    })
  }

  const sendMessage = async (text: string): Promise<MobileNativeChatSendOutcome> => {
    let outcome: MobileNativeChatSendOutcome = 'rejected'
    await act(async () => {
      const sending = api!.sendWithOutcome(text)
      await vi.runAllTimersAsync()
      outcome = await sending
    })
    return outcome
  }

  beforeEach(() => {
    vi.useFakeTimers()
    acceptSend.mockReset()
    clearDraftForSend.mockReset()
    restoreRejectedDraft.mockReset()
    holdUnconfirmedSend.mockReset()
    report = vi.fn()
    resetMobileNativeChatTerminalWritesForTests()
    resetMobileNativeChatStaleInputForTests()
  })
  afterEach(() => {
    act(() => {
      renderer?.unmount()
    })
    renderer = null
    api = null
    vi.useRealTimers()
  })

  it('sizes the message the way the report did', () => {
    expect(MESSAGE).toHaveLength(176)
  })

  for (const publishes of ['draft', 'tail'] as const) {
    it(`reaches Claude once, as the message and nothing else (composer text published in ${publishes})`, async () => {
      const host = createFakeComposerHost({ publishes })
      host.holdInput(MESSAGE)
      mount(host)

      const outcome = await sendMessage(MESSAGE)

      expect(host.submitted).toEqual([MESSAGE])
      expect(host.notice).toBeNull()
      expect(outcome).toBe('accepted')
      expect(acceptSend).toHaveBeenCalledTimes(1)
      expect(restoreRejectedDraft).not.toHaveBeenCalled()
    })
  }

  it('never writes a control burst of 64 bytes or more in one read', async () => {
    const host = createFakeComposerHost()
    host.holdInput(MESSAGE)
    mount(host)

    await sendMessage(MESSAGE)

    for (const send of host.sends.filter((write) => !write.enter)) {
      expect(send.text.length).toBeLessThan(64)
    }
    // A control byte in a read of 64 or more is text; the body is a read of its own.
    expect(host.readSizes.filter((size) => size >= 64 && size !== MESSAGE.length)).toEqual([])
  })

  it('looks at the input before it types the message, and again after it cleared', async () => {
    const host = createFakeComposerHost()
    host.holdInput(MESSAGE)
    mount(host)

    await sendMessage(MESSAGE)

    const order = host.handle.mock.calls.map(([method, params]) => {
      const body = params as { text?: string; enter?: boolean }
      return method === 'terminal.read' ? 'read' : body.enter ? 'body' : 'clear'
    })
    expect(order.slice(0, 4)).toEqual(['read', 'clear', 'read', 'body'])
  })

  it('refuses and writes nothing more when the input cannot be cleared, and keeps the draft', async () => {
    // A host on which no control byte works, whatever the phone does.
    const host = createFakeComposerHost({ controlsAreLiteral: true })
    host.holdInput(MESSAGE)
    mount(host)

    const outcome = await sendMessage(MESSAGE)

    expect(outcome).toBe('rejected')
    expect(host.sends.some((write) => write.enter)).toBe(false)
    expect(host.enters).toBe(0)
    expect(acceptSend).not.toHaveBeenCalled()
    expect(restoreRejectedDraft).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith(STILL_HOLDS)
    // One clear and one more, each followed by a look; then it stops.
    expect(host.sends.filter((write) => !write.enter)).toHaveLength(2)
  })

  it('does not call a send delivered when Claude answers it with the review notice', async () => {
    // Late junk reaches the input just before the Enter: Claude strips it,
    // asks the user to review, and submits nothing.
    const host = createFakeComposerHost({ junkBeforeEnter: '\x15\x15\x0b' })
    mount(host)

    const outcome = await sendMessage('check the build')

    expect(host.submitted).toEqual([])
    expect(outcome).toBe('rejected')
    expect(acceptSend).not.toHaveBeenCalled()
    expect(restoreRejectedDraft).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith(
      expect.stringContaining('Removed 3 invisible characters · review and press Enter to send')
    )
    // Claude asked the user to review. The phone does not press Enter again.
    expect(host.enters).toBe(1)
  })

  it('does not let an older prompt copy with the same words stand in for this send', async () => {
    // The beacon's history reaches back across sends: the same words sent an
    // hour ago are in it, and say nothing about this one.
    const host = createFakeComposerHost({ junkBeforeEnter: '\x15\x0b' })
    mount(host, 'claude', [{ nonce: 'from-an-hour-ago', text: 'check the build' }])

    const outcome = await sendMessage('check the build')

    expect(outcome).toBe('rejected')
    expect(acceptSend).not.toHaveBeenCalled()
    expect(restoreRejectedDraft).toHaveBeenCalledTimes(1)
  })

  it('holds the send for the transcript, and draws no bubble, when the screen cannot say either way', async () => {
    // A dialog took the composer's place after the Enter: looks were had, none
    // settled it, the message may well have gone.
    const host = createFakeComposerHost({ dialogAfterEnter: true })
    mount(host)

    const outcome = await sendMessage('run the tests')

    expect(outcome).toBe('unknown')
    expect(host.submitted).toEqual(['run the tests'])
    expect(holdUnconfirmedSend).toHaveBeenCalledTimes(1)
    expect(acceptSend).not.toHaveBeenCalled()
    expect(restoreRejectedDraft).not.toHaveBeenCalled()
  })

  it('still keeps the clear and the long body out of one read when the screen cannot be read at all', async () => {
    // No look to size or check the clear: it goes out as one write, and the pause
    // after it is what keeps it from coalescing with the 176-character body into
    // one read of 200 bytes, in which every control byte is text.
    const host = createFakeComposerHost()
    host.holdInput(MESSAGE)
    const base = host.handle.getMockImplementation()!
    host.handle.mockImplementation(async (method: string, params: unknown) => {
      if (method === 'terminal.read') {
        throw new Error('Request timed out')
      }
      return base(method, params)
    })
    mount(host)

    const outcome = await sendMessage(MESSAGE)

    expect(host.submitted).toEqual([MESSAGE])
    expect(host.notice).toBeNull()
    expect(outcome).toBe('accepted')
    expect(acceptSend).toHaveBeenCalledTimes(1)
  })

  it('keeps a Codex tab on its own send: no look at a Claude composer, the same bytes', async () => {
    const host = createFakeComposerHost()
    mount(host, 'codex')

    await sendMessage('hello codex')

    expect(host.reads).toBe(0)
  })

  it('clears a very tall input in two passes and still sends the message once', async () => {
    const host = createFakeComposerHost()
    host.holdInput('long '.repeat(600))
    mount(host)

    const outcome = await sendMessage('the short one')

    expect(host.submitted).toEqual(['the short one'])
    expect(outcome).toBe('accepted')
    expect(
      host.sends.filter((write) => !write.enter).every((write) => write.text.length < 64)
    ).toBe(true)
  })

  it('sends a one-character message into an input that holds nothing', async () => {
    const host = createFakeComposerHost()
    mount(host)

    const outcome = await sendMessage('y')

    expect(host.submitted).toEqual(['y'])
    expect(outcome).toBe('accepted')
  })

  it('treats the queue hint Claude paints in an empty input as empty', async () => {
    const host = createFakeComposerHost({ placeholder: 'Press up to edit queued messages' })
    mount(host)

    const outcome = await sendMessage('queued behind the turn')

    expect(host.submitted).toEqual(['queued behind the turn'])
    expect(outcome).toBe('accepted')
  })
})
