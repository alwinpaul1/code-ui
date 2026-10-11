// Reported 2026-10-11: a long message sent from the composer to a Claude Code 2.1.296 tab got
// "Claude's input box isn't on the desktop screen, so the message was not typed." and never
// reached Claude. The composer's send looks at the screen in the image hook
// (sendFollowingTheTab), before the text send runs, so that is where a refusal before any write
// has to end the way the Claude app's does: nothing lost. A refusal with no input box to type
// into (or no desktop) hands the message to the outbox, which types it once the box is back, and
// says so; any other refusal keeps the words in the composer with a Retry (S4, S5).

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { claudeExitedToShell, SHELL_PROMPTS } from './fixtures/claude-exited-to-shell-2.1.287'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatImageAttachments } from './use-mobile-native-chat-image-attachments'
import { readSendUnderDialogRefusal, SEND_UNDER_DIALOG_REFUSAL, SEND_WITHOUT_COMPOSER_REFUSAL } from './mobile-native-chat-dialog-guard'
import { INPUT_BOX_REFUSALS, SEND_WAITS_FOR_DESKTOP } from './native-chat-send-gate-outbox'

vi.mock('../platform/media-picker', () => ({ useMediaPicker: () => ({ pickImages: vi.fn() }) }))
vi.mock('./mobile-image-source-picker', () => ({ pickMobileDocuments: vi.fn(), pickMobileImageFiles: vi.fn() }))
vi.mock('expo-clipboard', () => ({ hasImageAsync: vi.fn(async () => false), getImageAsync: vi.fn(async () => null), setStringAsync: vi.fn() }))

import { baseArgs, makeClient, sendResult, type Hook, type HookArgs } from './use-mobile-native-chat-image-attachments.test-support'

const TEXT = 'Answers: 1. keep the sizes. 2. the photo goes in the card.\n\n3. yes, ship it.'
const read = (lines: string[]): RpcResponse => ({ id: 'read', ok: true, result: { terminal: { lines, source: 'screen' } }, _meta: { runtimeId: 'r' } })
const SHELL = claudeExitedToShell(SHELL_PROMPTS.zsh)
const DIALOG = ['⏺ Done.', ' Do you want to make this edit to about.tsx?', ' ❯ 1. Yes', '   2. No (esc)']

describe('a composer text send refused before anything was written', () => {
  let renderer: ReactTestRenderer | null = null
  let hook: Hook | null = null

  function Harness({ args }: { args: HookArgs }): null {
    hook = useMobileNativeChatImageAttachments(args)
    return null
  }

  beforeEach(() => {
    resetMobileNativeChatStaleInputForTests()
    resetMobileNativeChatTerminalWritesForTests()
    useNativeChatImageAttachmentsStore.getState().reset()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    hook = null
  })

  async function send(screen: string[], overrides: Partial<HookArgs>) {
    const client = makeClient((method) => (method === 'terminal.read' ? read(screen) : sendResult(true)))
    const args = baseArgs({ client: client as unknown as RpcClient, refuseUnderDialog: readSendUnderDialogRefusal, ...overrides })
    act(() => {
      renderer = create(createElement(Harness, { args }))
    })
    let sent: boolean | undefined
    await act(async () => {
      sent = await hook!.sendNativeChat(TEXT)
    })
    return { sent, args, client }
  }

  it('waits in the outbox when Claude’s input box is not on the screen, and says it will send when it is back', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const parkRefusedSend = vi.fn(() => true)
    const { sent, args, client } = await send(SHELL, { parkRefusedSend })
    expect(sent).toBe(true)
    expect(parkRefusedSend).toHaveBeenCalledExactlyOnceWith(TEXT)
    expect(args.baseSend).not.toHaveBeenCalled()
    expect(client.calls.some((call) => call.method === 'terminal.send')).toBe(false)
    expect(args.onSendError).toHaveBeenCalledExactlyOnceWith(INPUT_BOX_REFUSALS.get(SEND_WITHOUT_COMPOSER_REFUSAL))
    expect(INPUT_BOX_REFUSALS.get(SEND_WITHOUT_COMPOSER_REFUSAL)).toMatch(/will send when it is back/)
  })

  it('keeps the words in the composer with a Retry when the outbox cannot see it through', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { sent, args } = await send(SHELL, { parkRefusedSend: () => false })
    expect(sent).toBe(false)
    expect(args.onSendError).toHaveBeenCalledExactlyOnceWith(SEND_WITHOUT_COMPOSER_REFUSAL, { retry: true })
  })

  it('keeps the words in the composer with a Retry when a prompt is waiting, never parking it', async () => {
    const parkRefusedSend = vi.fn(() => true)
    const { sent, args } = await send(DIALOG, { parkRefusedSend })
    expect(sent).toBe(false)
    expect(parkRefusedSend).not.toHaveBeenCalled()
    expect(args.onSendError).toHaveBeenCalledExactlyOnceWith(SEND_UNDER_DIALOG_REFUSAL, { retry: true })
  })

  it('waits in the outbox when the desktop never came back within the send’s budget', async () => {
    const parkRefusedSend = vi.fn(() => true)
    const client = { ...makeClient(() => sendResult(true)), getState: () => 'disconnected' as const, getLastConnectedAt: () => 1 }
    const args = baseArgs({ client: client as unknown as RpcClient, refuseUnderDialog: readSendUnderDialogRefusal, parkRefusedSend })
    vi.useFakeTimers()
    try {
      act(() => {
        renderer = create(createElement(Harness, { args }))
      })
      let sent: boolean | undefined
      let settled = false
      await act(async () => {
        void hook!.sendNativeChat(TEXT).then((value) => {
          sent = value
          settled = true
        })
      })
      for (let step = 0; step < 300 && !settled; step += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(100)
        })
      }
      expect(sent).toBe(true)
      expect(parkRefusedSend).toHaveBeenCalledExactlyOnceWith(TEXT)
      expect(args.onSendError).toHaveBeenCalledExactlyOnceWith(SEND_WAITS_FOR_DESKTOP)
    } finally {
      vi.useRealTimers()
    }
  })
})
