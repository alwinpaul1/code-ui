import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingNativeChatImage } from './mobile-native-chat-image-attachment'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import { withScopeAttachments } from './mobile-native-chat-image-scope-state'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatImageAttachments } from './use-mobile-native-chat-image-attachments'
import { laneArgs, uploadHost } from './use-mobile-native-chat-image-attachments.send-while-uploading.test-support'
import { ok, SCOPE_A, type Hook, type HookArgs } from './use-mobile-native-chat-image-attachments.test-support'

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
// - at most 20 attachments to a message (`cai_file_upload_config.
//   max_per_message_upload_count`, default 20 in `l1f`); a pick past it keeps
//   the first ones that fit and says "You can add at most 20 attachments to a
//   message." (`chat_input_attachment_limit_reached_toast`; `cym`, `rs8.v`);

const LIMIT_LINE = 'You can add at most 20 attachments to a message.'

function seeded(count: number): PendingNativeChatImage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `seed-${i + 1}`,
    path: `/tmp/seed-${i + 1}.png`,
    previewUri: `file:///seed-${i + 1}.jpg`
  }))
}

function seed(count: number): void {
  useNativeChatImageAttachmentsStore
    .getState()
    .update((prev) => withScopeAttachments(prev, SCOPE_A, seeded(count)))
}

function photos(names: string[]): { base64: string; uri: string }[] {
  return names.map((name) => ({ base64: 'AAAA', uri: `file:///${name}.jpg` }))
}

describe('the Claude app\'s attachment limit', () => {
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

  describe('the 20-attachment limit', () => {
    it('keeps the first photos that fit and says the limit when a pick runs past 20', async () => {
      seed(18)
      pick.mockResolvedValue(photos(['a', 'b', 'c']))
      const { client } = uploadHost([ok('save-a', '/tmp/a.png'), ok('save-b', '/tmp/b.png')])
      const args = laneArgs('terminal', client)
      mount(args)

      await act(async () => {
        await hook!.attachImage('library')
      })

      expect(hook!.attachments).toHaveLength(20)
      expect(hook!.attachments.slice(18).map((chip) => chip.path)).toEqual(['/tmp/a.png', '/tmp/b.png'])
      expect(hook!.attachments.some((chip) => chip.previewUri === 'file:///c.jpg')).toBe(false)
      expect(args.showToast).toHaveBeenCalledWith(LIMIT_LINE, expect.any(Number))
      expect(args.showToast).toHaveBeenCalledOnce()
    })

    it('uploads nothing and says the limit when the strip already holds 20', async () => {
      seed(20)
      pick.mockResolvedValue(photos(['a']))
      // An upload here would take an answer the queue does not have and throw.
      const { client } = uploadHost([])
      const args = laneArgs('terminal', client)
      mount(args)

      await act(async () => {
        await hook!.attachImage('library')
      })

      expect(hook!.attachments.map((chip) => chip.id)).toEqual(seeded(20).map((chip) => chip.id))
      expect(args.showToast).toHaveBeenCalledExactlyOnceWith(LIMIT_LINE, expect.any(Number))
    })

    it('says nothing when a pick fills the strip to exactly 20', async () => {
      seed(19)
      pick.mockResolvedValue(photos(['a']))
      const { client } = uploadHost([ok('save-a', '/tmp/a.png')])
      const args = laneArgs('terminal', client)
      mount(args)

      await act(async () => {
        await hook!.attachImage('library')
      })

      expect(hook!.attachments).toHaveLength(20)
      expect(args.showToast).not.toHaveBeenCalled()
    })

    it('takes a single photo into an empty strip with no limit line', async () => {
      pick.mockResolvedValue(photos(['a']))
      const { client } = uploadHost([ok('save-a', '/tmp/a.png')])
      const args = laneArgs('terminal', client)
      mount(args)

      await act(async () => {
        await hook!.attachImage('library')
      })

      expect(hook!.attachments.map((chip) => chip.path)).toEqual(['/tmp/a.png'])
      expect(args.showToast).not.toHaveBeenCalled()
    })
  })
})
