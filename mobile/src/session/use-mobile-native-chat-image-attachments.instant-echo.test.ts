// docs/claude-app-parity.md item 8, 2026-09-24: a structured send never called
// beginImageSend, so the chips sat in the composer for the whole RPC while
// clearDraftForSend (inside the bridge) emptied the text at once — text left,
// media lingered, then the screen "refreshed" once the send resolved. The
// Claude app clears text and media together and shows the bubble at once.
// Split from the main suite (already at its max-lines ceiling).

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import type { RpcClient } from '../transport/rpc-client'
import {
  resetMobileNativeChatStaleInputForTests
} from './mobile-native-chat-stale-input'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatImageAttachments } from './use-mobile-native-chat-image-attachments'

const pick = vi.hoisted(() => vi.fn())
vi.mock('../platform/media-picker', () => ({ useMediaPicker: () => ({ pickImages: pick }) }))
vi.mock('./mobile-image-source-picker', () => ({
  pickMobileDocuments: vi.fn(),
  pickMobileImageFiles: vi.fn()
}))

import {
  baseArgs,
  makeClient,
  methodNotFound,
  ok,
  sendResult,
  type Hook,
  type HookArgs
} from './use-mobile-native-chat-image-attachments.test-support'

vi.mock('expo-clipboard', () => ({
  hasImageAsync: vi.fn(async () => false),
  getImageAsync: vi.fn(async () => null),
  setStringAsync: vi.fn()
}))

describe('the optimistic bubble and the chips leave the composer together', () => {
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

  function mount(args: HookArgs): void {
    act(() => {
      renderer = create(createElement(Harness, { args }))
    })
  }

  describe('structured native chat', () => {
    it('empties the chips via beginImageSend before the RPC settles, not after', async () => {
      pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
      const client = makeClient([methodNotFound('start'), ok('save', '/tmp/a.png')])
      let resolveSend: ((outcome: 'accepted' | 'rejected' | 'unknown') => void) | null = null
      const baseSend = vi.fn(
        () =>
          new Promise<'accepted' | 'rejected' | 'unknown'>((resolve) => {
            resolveSend = resolve
          })
      )
      const beginImageSend = vi.fn(() => vi.fn())
      mount(
        baseArgs({
          client: client as unknown as RpcClient,
          baseSend,
          structuredNativeChat: true,
          beginImageSend
        })
      )
      await act(async () => {
        await hook!.attachImage('library')
      })
      expect(hook!.attachments).toHaveLength(1)

      let sendPromise: Promise<boolean> | null = null
      await act(async () => {
        sendPromise = hook!.sendNativeChat('caption')
        // Drain microtasks until the send parks on the still-open baseSend.
        for (let i = 0; i < 50 && !resolveSend; i++) {
          await Promise.resolve()
        }
      })

      // The chips and the echo left together, before the RPC ever answered.
      expect(beginImageSend).toHaveBeenCalledWith('caption', ['file:///a.jpg'])
      expect(hook!.attachments).toEqual([])

      await act(async () => {
        resolveSend!('accepted')
        await sendPromise
      })
      expect(hook!.attachments).toEqual([])
    })

    it('restores the text, the chips and the echo on a definite rejection', async () => {
      pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
      const client = makeClient([methodNotFound('start'), ok('save', '/tmp/a.png')])
      const baseSend = vi.fn().mockResolvedValue('rejected')
      const undoDraftClear = vi.fn()
      const beginImageSend = vi.fn(() => undoDraftClear)
      mount(
        baseArgs({
          client: client as unknown as RpcClient,
          baseSend,
          structuredNativeChat: true,
          beginImageSend
        })
      )
      await act(async () => {
        await hook!.attachImage('library')
      })

      let accepted = true
      await act(async () => {
        accepted = await hook!.sendNativeChat('caption')
      })

      expect(accepted).toBe(false)
      // The undo puts the text back (mobile-native-chat-draft-send-start.ts);
      // the chips come back here, alongside it, in the same failure branch.
      expect(undoDraftClear).toHaveBeenCalledTimes(1)
      expect(hook!.attachments).toHaveLength(1)
      expect(hook!.attachments[0]?.previewUri).toBe('file:///a.jpg')
    })

    it('keeps a video attachment leaving with the text, same as a photo', async () => {
      pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///clip.mp4' }])
      const client = makeClient([methodNotFound('start'), ok('save', '/tmp/clip.mp4')])
      const baseSend = vi.fn().mockResolvedValue('accepted')
      const beginImageSend = vi.fn(() => vi.fn())
      mount(
        baseArgs({
          client: client as unknown as RpcClient,
          baseSend,
          structuredNativeChat: true,
          beginImageSend
        })
      )
      await act(async () => {
        await hook!.attachImage('library')
      })

      let accepted = false
      await act(async () => {
        accepted = await hook!.sendNativeChat('watch this')
      })

      expect(accepted).toBe(true)
      expect(beginImageSend).toHaveBeenCalledWith('watch this', ['file:///clip.mp4'])
      expect(hook!.attachments).toEqual([])
    })
  })

  // The terminal-paste branch already cleared the chips at send start
  // (2026-09-13); it must also hand the preview URIs to beginImageSend so the
  // bubble it adds carries the thumbnail from the first tick, not just an
  // empty text echo.
  it('hands the preview URIs to beginImageSend for a terminal-paste send', async () => {
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    const client = makeClient([
      methodNotFound('start'),
      ok('save', '/tmp/a.png'),
      sendResult(true), // Ctrl+U clear
      sendResult(true) // image paste
    ])
    const baseSend = vi.fn().mockResolvedValue('accepted')
    const beginImageSend = vi.fn(() => vi.fn())
    mount(baseArgs({ client: client as unknown as RpcClient, baseSend, beginImageSend }))
    await act(async () => {
      await hook!.attachImage('library')
    })
    await act(async () => {
      await hook!.sendNativeChat('caption')
    })
    expect(beginImageSend).toHaveBeenCalledWith('caption', ['file:///a.jpg'])
  })

  it("retracts the bubble via beginImageSend's undo when a pasted image submit is rejected", async () => {
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    const client = makeClient([
      methodNotFound('start'),
      ok('save', '/tmp/a.png'),
      sendResult(true), // Ctrl+U clear
      sendResult(true) // image paste
    ])
    const baseSend = vi.fn().mockResolvedValue('rejected')
    const undoDraftClear = vi.fn()
    const beginImageSend = vi.fn(() => undoDraftClear)
    mount(baseArgs({ client: client as unknown as RpcClient, baseSend, beginImageSend }))
    await act(async () => {
      await hook!.attachImage('library')
    })
    let accepted = true
    await act(async () => {
      accepted = await hook!.sendNativeChat('caption')
    })
    expect(accepted).toBe(false)
    expect(undoDraftClear).toHaveBeenCalledTimes(1)
    expect(hook!.attachments).toHaveLength(1)
  })
})
