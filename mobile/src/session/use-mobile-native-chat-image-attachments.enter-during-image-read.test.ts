// 2026-10-03 (Code UI 0.9.113, Claude Code 2.1.288): a send of three photos and a caption
// drew a sent bubble and left the photos and the words in the desktop input, unsubmitted.
//
// THE CAUSE, from the 2.1.288 binary (`strings`, read, never run). The paste handler
// (`NVe`) treats a pasted image PATH as an asynchronous read: it raises its pasting flag
// (`f.current=!0`), reads and resizes the file, then inserts the `[Image #N]` chip and
// clears the flag (`I()`). A Return key that arrives meanwhile is swallowed and
// remembered (`E.current=!0`), and `I()` clears that memory (`E.current=!1`) without
// submitting; only the TEXT-paste path (`G()`) replays it. The host writes the body and
// then, about half a second later, the Enter; the phone waited a fixed 300 ms after the
// last paste. A photo read slower than about 800 ms swallowed the Enter.
//
// MODELLED, not captured: the read time (a fixed READ_MS per photo), the caption landing
// in the input as the host types it, the chips arriving at the end of the input when each
// read finishes, the 500 ms body-to-Enter gap, and a screen drawn as in
// fixtures/claude-composer-2.1.287. The swallow rule itself is the binary's.

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import type { RpcClient } from '../transport/rpc-client'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatImageAttachments } from './use-mobile-native-chat-image-attachments'
import { writeChatSend } from './mobile-native-chat-send-write'

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

import { baseArgs, methodNotFound, ok, type Hook, type HookArgs } from './use-mobile-native-chat-image-attachments.test-support'

const RULE = '─'.repeat(190)
const BELOW = '  ⏵⏵ auto mode on (shift+tab to cycle)'
const CAPTION = 'what is wrong with these three screens'
const ENTER_AFTER_BODY_MS = 500

/** Claude's input as the binary has it: a path paste starts a read; Return during any read is lost. */
function fakeClaude(readMs: number) {
  let input = ''
  let chip = 0
  let reading = 0
  const echoes: string[] = []
  const enters: { at: number; took: boolean }[] = []
  const t0 = Date.now()
  const pressEnter = (): void => {
    const took = reading === 0 && input.trim() !== ''
    enters.push({ at: Date.now() - t0, took })
    if (took) {
      echoes.push(`❯ ${input}`)
      input = ''
    }
  }
  const screen = (): string[] => [
    '⏺ Done.', ...echoes, RULE, input === '' ? '❯ ' : `❯ ${input}`, RULE, BELOW
  ]
  const handle = async (method: string, params: { text?: string; enter?: boolean }) => {
    if (method === 'terminal.read') {
      return ok('r', { terminal: { source: 'screen', tail: screen(), draft: '' } })
    }
    if (method !== 'terminal.send') {
      return null
    }
    const text = params.text ?? ''
    if (text.startsWith('\x1b[200~')) {
      reading += 1
      setTimeout(() => {
        chip += 1
        input += `[Image #${chip}]`
        reading -= 1
      }, readMs)
    } else if (text.length > 0 && text.length < 64 && [...text].every((c) => c.charCodeAt(0) < 32)) {
      // The clear's Ctrl+U / Ctrl+K burst, in a read under 64 bytes: keys, and the input empties.
      input = ''
    } else {
      input += text
      if (params.enter) {
        setTimeout(pressEnter, ENTER_AFTER_BODY_MS)
      }
    }
    return ok('s', { send: { accepted: true } })
  }
  return { handle, echoes, enters, input: () => input }
}

describe('a photo send submits even when Claude is slow to read the photos', () => {
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

  async function send(photos: number, caption: string, readMs: number) {
    pick.mockResolvedValue(Array.from({ length: photos }, (_, n) => ({ base64: 'AAAA', uri: `file:///p${n}.jpg` })))
    vi.useFakeTimers()
    const claude = fakeClaude(readMs)
    let uploads = 0
    const client = {
      getState: () => 'connected',
      notifyForeground: vi.fn(),
      sendRequest: vi.fn(async (method: string, params: { text?: string; enter?: boolean }) => {
        const answered = await claude.handle(method, params)
        if (answered) {
          return answered
        }
        uploads += 1
        return uploads % 2 === 1 ? methodNotFound('start') : ok('save', `/tmp/p${uploads}.png`)
      })
    }
    const onSendError = vi.fn()
    const undo = vi.fn()
    const baseSend = async (text: string, _previews?: string[], deadline?: number) => {
      const written = await writeChatSend({
        agent: 'claude', client: client as unknown as RpcClient, terminal: 'term-1', text, hasImages: true,
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
        args: baseArgs({ agent: 'claude', client: client as unknown as RpcClient, baseSend, onSendError, beginImageSend: () => undo })
      }))
    })
    await act(async () => { await hook!.attachImage('library') })
    expect(hook!.attachments).toHaveLength(photos)
    let sent: boolean | null = null
    await act(async () => {
      const sending = hook!.sendNativeChat(caption)
      await vi.advanceTimersByTimeAsync(40_000)
      sent = await sending
    })
    return { sent, claude, onSendError, undo }
  }

  it('submits three photos and a caption when each photo takes 1.2 s to read, with one Enter taken', async () => {
    const r = await send(3, CAPTION, 1_200)

    expect(r.claude.echoes).toEqual([`❯ [Image #1][Image #2][Image #3]${CAPTION}`])
    expect(r.claude.enters.filter((e) => e.took)).toHaveLength(1)
    expect(r.claude.enters).toHaveLength(1) // never pressed twice
    expect(r.claude.input()).toBe('')
    expect(r.sent).toBe(true)
  })

  it('submits one photo with no text when the photo takes 1.2 s to read', async () => {
    const r = await send(1, '', 1_200)

    expect(r.claude.echoes).toEqual(['❯ [Image #1]'])
    expect(r.claude.enters).toHaveLength(1)
  })

  it('still submits when the photos are read at once (the case that always worked)', async () => {
    const r = await send(3, CAPTION, 5)

    expect(r.claude.echoes).toHaveLength(1)
    expect(r.claude.enters).toHaveLength(1)
  })

  it('types no caption and presses no Enter when a photo is never attached, and puts the draft back', async () => {
    const r = await send(3, CAPTION, 60_000)

    expect(r.sent).toBe(false)
    expect(r.claude.enters).toHaveLength(0)
    expect(r.claude.input()).not.toContain(CAPTION)
    expect(r.onSendError).not.toHaveBeenCalledWith(expect.stringContaining('Claude says'))
    expect(r.undo).toHaveBeenCalledTimes(1)
    expect(hook!.attachments).toHaveLength(3)
  })
})
