// What the chat says about a confirmed `!` message after it was typed.
//
// Before: the send ended 'unknown' (the submit check looked for a `❯` echo that a shell command
// never draws) and said "Delivery unconfirmed — check chat before retrying", about a command
// that had run, and a retry would have run it twice. Now: Claude's own `! cmd` row counts as
// sent (mobile-native-chat-submit-verify-shell-command.test.ts), and when nothing settles it
// the word is about the SHELL, and never invites a retry.
//
// Screens MODELLED from Claude Code 2.1.287's binary (see that file); nothing was typed.

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { EMPTY_COMPOSER } from './fixtures/claude-composer-2.1.287'
import { SHELL_COMMAND_UNCONFIRMED } from './mobile-native-chat-shell-command'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatMessageSend } from './use-mobile-native-chat-message-send'

vi.mock('./mobile-native-chat-stale-input', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mobile-native-chat-stale-input')>()),
  healMobileNativeChatStaleInput: () => Promise.resolve(true)
}))

const reply = (lines: string[]): RpcResponse => ({
  id: 'r',
  ok: true,
  result: { terminal: { tail: lines, source: 'screen', draft: '' } },
  _meta: { runtimeId: 'r' }
})

describe('a confirmed ! message once it is typed', () => {
  let renderer: ReactTestRenderer | null = null
  let api: ReturnType<typeof useMobileNativeChatMessageSend> | null = null
  const acceptSend = vi.fn()
  const holdUnconfirmedSend = vi.fn()
  const report = vi.fn()
  let typed = false
  let screenAfter: string[] = EMPTY_COMPOSER

  const mount = (agent = 'claude'): void => {
    const handle = vi.fn(async (method: string, params: unknown) => {
      const body = (params ?? {}) as { text?: string }
      if (method === 'terminal.send') {
        typed = typed || (body.text ?? '').includes('!')
        return { id: 'r', ok: true, result: { send: { accepted: true } }, _meta: { runtimeId: 'r' } }
      }
      if (method === 'terminal.read') {
        return reply(typed ? screenAfter : EMPTY_COMPOSER)
      }
      throw new Error(`unexpected ${method}`)
    })
    const client = { sendRequest: handle, getState: () => 'connected', notifyForeground: vi.fn() } as unknown as RpcClient
    function Probe(): null {
      api = useMobileNativeChatMessageSend({
        client,
        enabled: true,
        handleRef: { current: 'term' },
        deviceTokenRef: { current: 'device' },
        agentRef: { current: agent },
        commandSendRef: { current: vi.fn() },
        captureSendOrigin: () => ({ draftKey: 'k', pendingKey: 'p' }) as never,
        readSeededLaunchDraftSeed: () => null,
        clearDraftForSend: vi.fn(),
        restoreRejectedDraft: vi.fn(),
        acceptSend,
        holdUnconfirmedSend,
        onSendError: report
      })
      return null
    }
    act(() => {
      renderer = create(createElement(Probe))
    })
  }
  async function send(text: string) {
    let outcome!: Awaited<ReturnType<NonNullable<typeof api>['sendWithOutcome']>>
    await act(async () => {
      const running = api!.sendWithOutcome(text)
      await vi.runAllTimersAsync()
      outcome = await running
    })
    return outcome
  }

  beforeEach(() => {
    vi.useFakeTimers()
    for (const fn of [acceptSend, holdUnconfirmedSend, report]) {
      fn.mockReset()
    }
    typed = false
    screenAfter = EMPTY_COMPOSER
    resetMobileNativeChatTerminalWritesForTests()
    resetMobileNativeChatStaleInputForTests()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    api = null
    vi.useRealTimers()
  })

  it('is sent, with no notice, once Claude has drawn the command in the conversation', async () => {
    screenAfter = ['! ls -la', ...EMPTY_COMPOSER]
    mount()

    expect(await send('!ls -la')).toBe('accepted')

    expect(report).not.toHaveBeenCalled()
    expect(holdUnconfirmedSend).not.toHaveBeenCalled()
    expect(acceptSend).toHaveBeenCalledTimes(1)
  })

  it('says it went to the desktop shell, and never invites a retry, when nothing settles it', async () => {
    mount()

    expect(await send('!ls -la')).toBe('unknown')

    // Held for the transcript (the command's own row), and the word it ends on is about the shell.
    expect(holdUnconfirmedSend).toHaveBeenCalledTimes(1)
    const [, text, onUnconfirmed] = holdUnconfirmedSend.mock.calls[0]!
    expect(text).toBe('!ls -la')
    onUnconfirmed()
    expect(report).toHaveBeenCalledExactlyOnceWith(SHELL_COMMAND_UNCONFIRMED)
    expect(SHELL_COMMAND_UNCONFIRMED).toBe(
      "Sent to the desktop's shell; check the terminal before running it again."
    )
    expect(SHELL_COMMAND_UNCONFIRMED).not.toMatch(/retry|try again|send again/i)
  })

  it('keeps the old word for an ordinary message nothing settles', async () => {
    mount()

    expect(await send('check the build')).toBe('unknown')

    const [, , onUnconfirmed] = holdUnconfirmedSend.mock.calls[0]!
    onUnconfirmed()
    expect(report).toHaveBeenCalledExactlyOnceWith('Delivery unconfirmed — check chat before retrying')
  })
})
