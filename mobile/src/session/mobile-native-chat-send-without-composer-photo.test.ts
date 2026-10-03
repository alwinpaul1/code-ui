// A photo sent to a Claude tab whose terminal is a shell must not be pasted
// into it. The paste types a Ctrl+U, the image path and a bracketed paste, and
// the text body that follows adds an Enter: all of it lands in whatever is
// listening (2026-10-02, Claude exited back to the shell in the same terminal).
// Screens: fixtures/claude-exited-to-shell-2.1.287.ts. See
// mobile-native-chat-send-without-composer.test.ts for the text send.

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { EMPTY_COMPOSER } from './fixtures/claude-composer-2.1.287'
import {
  claudeExitedToShell,
  plainShell,
  SHELL_PROMPTS
} from './fixtures/claude-exited-to-shell-2.1.287'
import {
  readSendUnderDialogRefusal,
  SEND_WITHOUT_CODEX_COMPOSER_REFUSAL,
  SEND_WITHOUT_COMPOSER_REFUSAL
} from './mobile-native-chat-dialog-guard'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatImageAttachments } from './use-mobile-native-chat-image-attachments'

const pick = vi.hoisted(() => vi.fn())
vi.mock('../platform/media-picker', () => ({ useMediaPicker: () => ({ pickImages: pick }) }))
vi.mock('./mobile-image-source-picker', () => ({
  pickMobileDocuments: vi.fn(),
  pickMobileImageFiles: vi.fn()
}))
vi.mock('expo-clipboard', () => ({
  hasImageAsync: vi.fn(async () => false),
  getImageAsync: vi.fn(async () => null),
  setStringAsync: vi.fn()
}))

import {
  baseArgs,
  composerHoldingChips,
  makeClient,
  methodNotFound,
  ok,
  sendResult,
  type Hook,
  type HookArgs
} from './use-mobile-native-chat-image-attachments.test-support'

const read = (lines: string[]): RpcResponse => ({
  id: 'read',
  ok: true,
  result: { terminal: { lines, source: 'screen' } },
  _meta: { runtimeId: 'r' }
})

describe('a photo sent from the chat to a terminal with no Claude input box', () => {
  let renderer: ReactTestRenderer | null = null
  let hook: Hook | null = null

  function Harness({ args }: { args: HookArgs }): null {
    hook = useMobileNativeChatImageAttachments(args)
    return null
  }

  beforeEach(() => {
    pick.mockReset()
    resetMobileNativeChatStaleInputForTests()
    resetMobileNativeChatTerminalWritesForTests()
    useNativeChatImageAttachmentsStore.getState().reset()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    hook = null
  })

  function setUp(screen: () => RpcResponse, overrides: Partial<HookArgs> = {}) {
    const attach = [methodNotFound('start'), ok('save', '/tmp/a.png')]
    let pasted = false
    const client = makeClient((method, params) => {
      if (method === 'terminal.send') {
        pasted ||= String(params.text ?? '').startsWith('\x1b[200~')
        return sendResult(true)
      }
      // Once the photo is pasted Claude's input holds its chip, which the send waits for.
      return method === 'terminal.read' ? (pasted ? read(composerHoldingChips(1)) : screen()) : attach.shift()!
    })
    const args = baseArgs({
      client: client as unknown as RpcClient,
      refuseUnderDialog: readSendUnderDialogRefusal,
      ...overrides
    })
    act(() => {
      renderer = create(createElement(Harness, { args }))
    })
    return { client, args }
  }
  const typed = (client: ReturnType<typeof makeClient>) =>
    client.calls.filter((call) => call.method === 'terminal.send')

  it.each([
    ['a zsh prompt under Claude\'s last frame', claudeExitedToShell(SHELL_PROMPTS.zsh)],
    ['a bash $ prompt under Claude\'s last frame', claudeExitedToShell(SHELL_PROMPTS.bash)],
    ['a plain fish shell', plainShell(SHELL_PROMPTS.fish)]
  ])('pastes nothing, and keeps the chip and the text: %s', async (_name, lines) => {
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    const beginImageSend = vi.fn(() => vi.fn())
    const { client, args } = setUp(() => read(lines), { beginImageSend })
    await act(async () => {
      await hook!.attachImage('library')
    })
    expect(hook!.attachments).toHaveLength(1)

    let sent: boolean | undefined
    await act(async () => {
      sent = await hook!.sendNativeChat('see this')
    })

    expect(sent).toBe(false)
    expect(typed(client)).toEqual([])
    expect(beginImageSend).not.toHaveBeenCalled()
    expect(args.baseSend).not.toHaveBeenCalled()
    expect(hook!.attachments).toHaveLength(1)
    expect(args.onSendError).toHaveBeenCalledExactlyOnceWith(SEND_WITHOUT_COMPOSER_REFUSAL)
  })

  it('refuses a text-only send from the same hook the same way', async () => {
    const { client, args } = setUp(() => read(claudeExitedToShell(SHELL_PROMPTS.zsh)))

    let sent: boolean | undefined
    await act(async () => {
      sent = await hook!.sendNativeChat('rm -rf build')
    })

    expect(sent).toBe(false)
    expect(typed(client)).toEqual([])
    expect(args.baseSend).not.toHaveBeenCalled()
    expect(args.onSendError).toHaveBeenCalledExactlyOnceWith(SEND_WITHOUT_COMPOSER_REFUSAL)
  })

  it('still pastes a photo into a live Claude box', async () => {
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    const { client, args } = setUp(() => read(EMPTY_COMPOSER))
    await act(async () => {
      await hook!.attachImage('library')
    })

    await act(async () => {
      await hook!.sendNativeChat('see this')
    })

    expect(typed(client).length).toBeGreaterThan(0)
    expect(args.baseSend).toHaveBeenCalledTimes(1)
    expect(args.onSendError).not.toHaveBeenCalled()
  })

  // The gap: no readable screen, no proof either way, so the paste goes.
  it('still pastes when the screen cannot be read (the stated gap)', async () => {
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    const { client, args } = setUp(() => ({
      id: 'read',
      ok: false,
      error: { code: 'method_not_found', message: 'no' },
      _meta: { runtimeId: 'r' }
    }))
    await act(async () => {
      await hook!.attachImage('library')
    })

    await act(async () => {
      await hook!.sendNativeChat('see this')
    })

    expect(typed(client).length).toBeGreaterThan(0)
    expect(args.baseSend).toHaveBeenCalledTimes(1)
  })

  it('refuses a photo into a shell for Codex too, in Codex\'s words', async () => {
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    const { client, args } = setUp(() => read(plainShell(SHELL_PROMPTS.zsh)), { agent: 'codex' })
    await act(async () => {
      await hook!.attachImage('library')
    })

    await act(async () => {
      await hook!.sendNativeChat('see this')
    })

    expect(typed(client)).toEqual([])
    expect(args.onSendError).toHaveBeenCalledWith(SEND_WITHOUT_CODEX_COMPOSER_REFUSAL)
  })
})
