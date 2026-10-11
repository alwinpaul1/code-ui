import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatImageAttachments } from './use-mobile-native-chat-image-attachments'
import {
  deferred,
  LANES,
  laneArgs,
  sentPaths,
  settle,
  uploadHost
} from './use-mobile-native-chat-image-attachments.send-while-uploading.test-support'
import { ok, type Hook, type HookArgs } from './use-mobile-native-chat-image-attachments.test-support'

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

// Photo attaching as the Claude app does it in a Claude Code session
// (com.anthropic.claude 1.261009.20, decompiled 2026-10-12, never run):
// - every chip has its remove "x", uploading or not, and removing one cancels
//   its upload (`g330.b`, `j29.k`).

function photos(names: string[]): { base64: string; uri: string }[] {
  return names.map((name) => ({ base64: 'AAAA', uri: `file:///${name}.jpg` }))
}

describe('a chip removed while its photo uploads, as in the Claude app', () => {
  let renderer: ReactTestRenderer | null = null
  let hook: Hook | null = null
  function Harness({ args }: { args: HookArgs }): null {
    hook = useMobileNativeChatImageAttachments(args)
    return null
  }
  function mount(args: HookArgs): void {
    act(() => {
      renderer = create(createElement(Harness, { args }))
    })
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

  describe('removing a photo while it uploads', () => {
    it('does not bring the chip back when its upload lands', async () => {
      pick.mockResolvedValue(photos(['a']))
      const save = deferred()
      const { client } = uploadHost([save.promise])
      mount(laneArgs('terminal', client))

      let attach: Promise<void> = Promise.resolve()
      await act(async () => {
        attach = hook!.attachImage('library')
        await settle()
      })
      const [chip] = hook!.attachments
      expect(chip).toMatchObject({ uploading: true })

      act(() => hook!.removeAttachment(chip!.id))
      expect(hook!.attachments).toEqual([])

      await act(async () => {
        save.resolve(ok('save-a', '/tmp/a.png'))
        await attach
      })
      expect(hook!.attachments).toEqual([])
    })

    it('keeps the other photos of the same pick when one of them is removed mid-upload', async () => {
      pick.mockResolvedValue(photos(['a', 'b']))
      const saveA = deferred()
      const { client } = uploadHost([saveA.promise, ok('save-b', '/tmp/b.png')])
      mount(laneArgs('terminal', client))

      let attach: Promise<void> = Promise.resolve()
      await act(async () => {
        attach = hook!.attachImage('library')
        await settle()
      })
      const [first] = hook!.attachments
      act(() => hook!.removeAttachment(first!.id))
      await act(async () => {
        saveA.resolve(ok('save-a', '/tmp/a.png'))
        await attach
      })
      expect(hook!.attachments.map((chip) => chip.path)).toEqual(['/tmp/b.png'])
    })

    it.each(LANES)(
      'sends without a photo removed while the send waited on it, instead of refusing (%s)',
      async (lane) => {
        pick.mockResolvedValueOnce(photos(['a']))
        const saveB = deferred()
        const { client, pasted } = uploadHost([ok('save-a', '/tmp/a.png'), saveB.promise])
        const args = laneArgs(lane, client)
        mount(args)
        await act(async () => {
          await hook!.attachImage('library')
        })
        pick.mockResolvedValueOnce(photos(['b']))

        let attach: Promise<void> = Promise.resolve()
        let sending: Promise<boolean> = Promise.resolve(false)
        await act(async () => {
          attach = hook!.attachImage('library')
          await settle()
          sending = hook!.sendNativeChat('look')
          await settle()
        })
        const waitingOn = hook!.attachments.find((chip) => chip.uploading)
        expect(waitingOn).toBeDefined()

        let accepted = false
        await act(async () => {
          hook!.removeAttachment(waitingOn!.id)
          accepted = await sending
          saveB.resolve(ok('save-b', '/tmp/b.png'))
          await attach
        })
        expect(accepted).toBe(true)
        expect(args.onSendError).not.toHaveBeenCalled()
        expect(sentPaths(lane, args, pasted)).toEqual(['/tmp/a.png'])
        expect(hook!.attachments).toEqual([])
      }
    )
    it.each(LANES)(
      'sends nothing at all when the only photo of a captionless send is removed while it waited (%s)',
      async (lane) => {
        pick.mockResolvedValueOnce(photos(['a']))
        const save = deferred()
        const { client, pasted } = uploadHost([save.promise])
        const args = laneArgs(lane, client)
        mount(args)

        let attach: Promise<void> = Promise.resolve()
        let sending: Promise<boolean> = Promise.resolve(true)
        await act(async () => {
          attach = hook!.attachImage('library')
          await settle()
          sending = hook!.sendNativeChat('')
          await settle()
        })
        let accepted = true
        await act(async () => {
          hook!.removeAttachment(hook!.attachments[0]!.id)
          accepted = await sending
          save.resolve(ok('save-a', '/tmp/a.png'))
          await attach
        })
        expect(accepted).toBe(false)
        expect(args.baseSend).not.toHaveBeenCalled()
        expect(pasted()).toEqual([])
        expect(args.onSendError).not.toHaveBeenCalled()
      }
    )
    it.each(LANES)(
      'keeps the words back, and says why, when every photo of the send is removed while it waited (%s)',
      async (lane) => {
        pick.mockResolvedValueOnce(photos(['a']))
        const save = deferred()
        const { client, pasted } = uploadHost([save.promise])
        const args = laneArgs(lane, client)
        mount(args)

        let attach: Promise<void> = Promise.resolve()
        let sending: Promise<boolean> = Promise.resolve(true)
        await act(async () => {
          attach = hook!.attachImage('library')
          await settle()
          sending = hook!.sendNativeChat('look')
          await settle()
        })
        let accepted = true
        await act(async () => {
          hook!.removeAttachment(hook!.attachments[0]!.id)
          accepted = await sending
          save.resolve(ok('save-a', '/tmp/a.png'))
          await attach
        })
        expect(accepted).toBe(false)
        expect(args.baseSend).not.toHaveBeenCalled()
        expect(pasted()).toEqual([])
        expect(args.onSendError).toHaveBeenCalledExactlyOnceWith(
          'Message not sent: its photo was removed. Send again to send the text alone'
        )
      }
    )
  })
})
