// 2026-10-03 (Code UI 0.9.113, Claude Code 2.1.288): a send of three photos and a
// caption drew a sent bubble while the photos and the words stayed, unsubmitted, in the
// desktop input. The photo send ended at the host's ack: it never looked at the screen
// (mobile-native-chat-send-write.ts), and the bubble and the cleared chips were already
// committed. These drive the real hook with the real write; the screens are MODELLED
// from the 2.1.288 chip literal `[Image #N]` (see
// mobile-native-chat-submit-verify-photos.test.ts for provenance).

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import type { RpcClient } from '../transport/rpc-client'
import { isMobileNativeChatInputStale, resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatImageAttachments } from './use-mobile-native-chat-image-attachments'
import { writeChatSend } from './mobile-native-chat-send-write'
import { REVIEW_NOTICE } from './fixtures/claude-composer-2.1.287'

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

import { baseArgs, ok, methodNotFound, type Hook, type HookArgs } from './use-mobile-native-chat-image-attachments.test-support'

const RULE = '─'.repeat(190)
const CAPTION = 'what is wrong with these three screens'
const BELOW = '  ⏵⏵ auto mode on (shift+tab to cycle)'
const chips = (n: number): string => Array.from({ length: n }, (_, i) => `[Image #${i + 1}]`).join('')
const held = (n: number, caption: string): string[] => ['⏺ Done.', RULE, `❯ ${chips(n)} ${caption}`.trimEnd(), RULE, BELOW]
const withNotice = (n: number, caption: string): string[] => [
  '⏺ Done.', `${' '.repeat(100)}${REVIEW_NOTICE}`, RULE, `❯ ${chips(n)} ${caption}`.trimEnd(), RULE, BELOW
]
const sentRow = (n: number, caption: string): string[] => [`❯ ${chips(n)} ${caption}`.trimEnd(), '⏺ Seen.', RULE, '❯ ', RULE, BELOW]

describe('a photo send that Claude did not take is not shown as sent', () => {
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
    vi.useRealTimers()
    act(() => renderer?.unmount())
    renderer = null
    hook = null
  })

  async function photoSend(photos: number, caption: string, screen: string[], agent: 'claude' | 'codex' = 'claude') {
    pick.mockResolvedValue(Array.from({ length: photos }, (_, n) => ({ base64: 'AAAA', uri: `file:///p${n}.jpg` })))
    let uploads = 0
    // Before the Enter the input holds the pasted chips (the send waits for them); after it, `screen`.
    let entered = false
    const calls: { method: string; params: { text?: string; enter?: boolean } }[] = []
    const client = {
      getState: () => 'connected',
      notifyForeground: vi.fn(),
      sendRequest: vi.fn(async (method: string, params: { text?: string; enter?: boolean }) => {
        calls.push({ method, params })
        if (method === 'terminal.send' && params.enter === true) {
          entered = true
        }
        if (method === 'terminal.send') {
          return ok('s', { send: { accepted: true } })
        }
        if (method === 'terminal.read') {
          return ok('r', { terminal: { source: 'screen', tail: entered ? screen : held(photos, ''), draft: '' } })
        }
        // Each upload asks for a streamed start (unsupported here), then saves whole.
        uploads += 1
        return uploads % 2 === 1 ? methodNotFound('start') : ok('save', `/tmp/p${uploads}.png`)
      })
    }
    const onSendError = vi.fn()
    const undo = vi.fn()
    const beginImageSend = vi.fn(() => undo)
    // What the message send does with the write: a stop is a rejection, said aloud.
    const baseSend = async (text: string, _previews?: string[], deadline?: number) => {
      const written = await writeChatSend({
        agent, client: client as unknown as RpcClient, terminal: 'term-1', text, hasImages: true,
        syncComposer: true, classification: 'chat', typesCodexCommand: false, seed: null, residue: null,
        deadline: deadline ?? Date.now() + 20_000, deviceToken: null, receipts: () => []
      })
      if (written.kind === 'stopped') {
        onSendError(written.message)
        return 'rejected' as const
      }
      return written.outcome
    }
    act(() => {
      renderer = create(createElement(Harness, {
        args: baseArgs({ agent, client: client as unknown as RpcClient, baseSend, onSendError, beginImageSend })
      }))
    })
    // One pick returns every photo; each uploads on its own.
    await act(async () => { await hook!.attachImage('library') })
    expect(hook!.attachments).toHaveLength(photos)
    vi.useFakeTimers()
    let sent: boolean | null = null
    await act(async () => {
      const sending = hook!.sendNativeChat(caption)
      await vi.advanceTimersByTimeAsync(30_000)
      sent = await sending
    })
    return { sent, onSendError, undo, calls }
  }

  it('puts the text, the chips and the bubble back, says why, and presses Enter once, when Claude shows its review notice', async () => {
    const r = await photoSend(3, CAPTION, withNotice(3, CAPTION))

    expect(r.sent).toBe(false)
    expect(r.onSendError).toHaveBeenCalledWith(`Not sent. Claude says: ${REVIEW_NOTICE}.`)
    expect(r.undo).toHaveBeenCalledTimes(1)
    expect(hook!.attachments).toHaveLength(3)
    expect(r.calls.filter((c) => c.method === 'terminal.send' && c.params.enter === true)).toHaveLength(1)
    // The photos and words are still on the desktop line: the next send clears it first.
    expect(isMobileNativeChatInputStale('term-1')).toBe(true)
  })

  it('does not restore or invite a resend when the chips and the caption stay in the input and nothing says it failed', async () => {
    const r = await photoSend(3, CAPTION, held(3, CAPTION))

    expect(r.sent).toBe(true) // held for the transcript, as a text send is
    expect(r.undo).not.toHaveBeenCalled()
    expect(hook!.attachments).toEqual([])
    expect(r.calls.filter((c) => c.method === 'terminal.send' && c.params.enter === true)).toHaveLength(1)
    // The photos may still be on the desktop line, so the next send clears it first.
    expect(isMobileNativeChatInputStale('term-1')).toBe(true)
  })

  it('says sent for one photo and no text, with no restore, when the chip is gone from the input', async () => {
    const r = await photoSend(1, '', sentRow(1, ''))
    // A chip-only prompt row alone is not proof (an earlier photo leaves one): held, not restored.
    expect(r.undo).not.toHaveBeenCalled()
    expect(r.onSendError).not.toHaveBeenCalled()
    expect(hook!.attachments).toEqual([])
  })

  it('says sent for three photos and a caption when the prompt is drawn above an empty input', async () => {
    const r = await photoSend(3, CAPTION, sentRow(3, CAPTION))

    expect(r.sent).toBe(true)
    expect(r.undo).not.toHaveBeenCalled()
    expect(r.onSendError).not.toHaveBeenCalled()
    expect(hook!.attachments).toEqual([])
  })

  it('claims no more for Codex than before: no screen read, sent on the host ack', async () => {
    const r = await photoSend(3, CAPTION, withNotice(3, CAPTION), 'codex')

    expect(r.sent).toBe(true)
    expect(r.calls.some((c) => c.method === 'terminal.read')).toBe(false)
    expect(r.undo).not.toHaveBeenCalled()
  })
})
