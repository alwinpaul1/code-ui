import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import { canRetryNativeChatUpload, retryNativeChatUpload } from './mobile-native-chat-upload-retry'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { useMobileNativeChatImageAttachments } from './use-mobile-native-chat-image-attachments'
import {
  baseArgs,
  makeClientWithoutScreen as makeClient,
  ok,
  SCOPE_A,
  type Hook,
  type HookArgs
} from './use-mobile-native-chat-image-attachments.test-support'

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

// Reported 2026-10-11: photos picked from the + sheet sat with the loading ring on their
// chips for a long time. Each photo's upload is one slot, one append per 512 KiB of base64
// and one commit, each a full relay round trip (250 ms floor) because every append waits
// for the last. A camera photo the picker did not scale is ~6 MiB: 8 MiB of base64, 16
// appends, 18 round trips, 4.5 s at the floor before bandwidth. And no chip of a pick was
// ready until the LAST photo of that pick had landed, so a three-photo pick held its first
// photo's chip for all three uploads.

/** A camera photo's worth of base64 (a 6 MiB JPEG). */
const LARGE_PHOTO_BASE64 = 'A'.repeat(8 * 1024 * 1024)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function failure(message: string): RpcResponse {
  return { id: 'x', ok: false, error: { code: 'failed', message }, _meta: { runtimeId: 'r' } }
}

async function flush(times = 50): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve()
  }
}

describe('a photo picked from the + sheet', () => {
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

  it("is ready to send once its own upload lands, while the next photo of the pick still uploads", async () => {
    pick.mockResolvedValue([
      { base64: LARGE_PHOTO_BASE64, uri: 'file:///big.jpg' },
      { base64: 'BBBB', uri: 'file:///small.jpg' }
    ])
    const secondCommit = deferred<RpcResponse>()
    let slots = 0
    const methods: string[] = []
    const client = makeClient((method) => {
      methods.push(method)
      if (method === 'clipboard.startImageUpload') {
        slots += 1
        return ok('start', { uploadId: `upload-${slots}` })
      }
      if (method === 'clipboard.appendImageUploadChunk') {
        return ok('append', {})
      }
      if (method === 'clipboard.commitImageUpload') {
        return slots === 1 ? ok('commit', '/tmp/big.jpg') : secondCommit.promise
      }
      throw new Error(`unexpected ${method}`)
    })
    mount(baseArgs({ client: client as unknown as RpcClient }))

    let attaching: Promise<void> = Promise.resolve()
    await act(async () => {
      attaching = hook!.attachImage('library')
      await flush()
    })

    // The relay cost of the large photo alone: one slot, 16 appends, one commit.
    expect(methods.slice(0, 18)).toEqual([
      'clipboard.startImageUpload',
      ...Array.from({ length: 16 }, () => 'clipboard.appendImageUploadChunk'),
      'clipboard.commitImageUpload'
    ])
    expect(methods.at(-1)).toBe('clipboard.commitImageUpload')
    const [big, small] = hook!.attachments
    expect(big).toMatchObject({ path: '/tmp/big.jpg', previewUri: 'file:///big.jpg' })
    expect(big?.uploading).toBeUndefined()
    expect(small).toMatchObject({ previewUri: 'file:///small.jpg', uploading: true })

    await act(async () => {
      secondCommit.resolve(ok('commit', '/tmp/small.jpg'))
      await attaching
    })
    expect(hook!.attachments.map((chip) => chip.path)).toEqual(['/tmp/big.jpg', '/tmp/small.jpg'])
    expect(hook!.attachments.every((chip) => chip.uploading === undefined)).toBe(true)
  })

  it('keeps a photo whose upload failed on its chip, marked failed, and still uploads the rest', async () => {
    pick.mockResolvedValue([
      { base64: 'AAAA', uri: 'file:///a.jpg' },
      { base64: 'BBBB', uri: 'file:///b.jpg' }
    ])
    let slots = 0
    const client = makeClient((method) => {
      if (method === 'clipboard.startImageUpload') {
        slots += 1
        return slots === 1 ? failure('Upload slot refused') : ok('start', { uploadId: 'upload-2' })
      }
      if (method === 'clipboard.appendImageUploadChunk') {
        return ok('append', {})
      }
      if (method === 'clipboard.commitImageUpload') {
        return ok('commit', '/tmp/b.jpg')
      }
      throw new Error(`unexpected ${method}`)
    })
    const showToast = vi.fn()
    mount(baseArgs({ client: client as unknown as RpcClient, showToast }))

    await act(async () => {
      await hook!.attachImage('library')
    })

    expect(hook!.attachments).toEqual([
      expect.objectContaining({ previewUri: 'file:///a.jpg', path: '', failed: true }),
      expect.objectContaining({ previewUri: 'file:///b.jpg', path: '/tmp/b.jpg' })
    ])
    expect(hook!.attachments[0]?.uploading).toBeUndefined()
    expect(showToast).toHaveBeenCalledWith('Attach failed', 1500)
  })

  it('retries a failed photo from its chip and makes it ready to send', async () => {
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    let refuse = true
    const client = makeClient((method) => {
      if (method === 'clipboard.startImageUpload') {
        return refuse ? failure('Upload slot refused') : ok('start', { uploadId: 'upload-2' })
      }
      if (method === 'clipboard.appendImageUploadChunk') {
        return ok('append', {})
      }
      if (method === 'clipboard.commitImageUpload') {
        return ok('commit', '/tmp/a.jpg')
      }
      throw new Error(`unexpected ${method}`)
    })
    mount(baseArgs({ client: client as unknown as RpcClient }))
    await act(async () => {
      await hook!.attachImage('library')
    })
    const failed = hook!.attachments[0]!
    expect(failed.failed).toBe(true)

    refuse = false
    let retried = false
    await act(async () => {
      retried = await retryNativeChatUpload(failed.id)
    })
    expect(retried).toBe(true)
    expect(hook!.attachments).toEqual([
      expect.objectContaining({ id: failed.id, previewUri: 'file:///a.jpg', path: '/tmp/a.jpg' })
    ])
    expect(hook!.attachments[0]?.failed).toBeUndefined()
    expect(hook!.attachments[0]?.uploading).toBeUndefined()
  })

  it('marks the chip failed again, with a toast, when the retry fails too', async () => {
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    const client = makeClient((method) => {
      if (method === 'clipboard.startImageUpload') {
        return failure('Upload slot refused')
      }
      throw new Error(`unexpected ${method}`)
    })
    const showToast = vi.fn()
    mount(baseArgs({ client: client as unknown as RpcClient, showToast }))
    await act(async () => {
      await hook!.attachImage('library')
    })
    const failed = hook!.attachments[0]!
    showToast.mockClear()
    await act(async () => {
      await retryNativeChatUpload(failed.id)
    })
    expect(hook!.attachments).toEqual([expect.objectContaining({ id: failed.id, failed: true })])
    expect(showToast).toHaveBeenCalledWith('Upload failed: Upload slot refused', 2000)
  })

  it('can take a failed photo out of the strip, and a retry after that does nothing', async () => {
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    const client = makeClient((method) => {
      if (method === 'clipboard.startImageUpload') {
        return failure('Upload slot refused')
      }
      throw new Error(`unexpected ${method}`)
    })
    mount(baseArgs({ client: client as unknown as RpcClient }))
    await act(async () => {
      await hook!.attachImage('library')
    })
    const failed = hook!.attachments[0]!
    act(() => hook!.removeAttachment(failed.id))
    expect(hook!.attachments).toEqual([])
    let retried = true
    await act(async () => {
      retried = await retryNativeChatUpload(failed.id)
    })
    expect(retried).toBe(false)
    expect(useNativeChatImageAttachmentsStore.getState().byScope[SCOPE_A]).toBeUndefined()
  })

  it('retries through the connection the screen has now, not the one the pick went out on', async () => {
    // Opus review, 2026-10-12: a dropped relay is the likeliest reason an upload fails, and a
    // reconnect is a new client. A retry pinned to the old one could never succeed.
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    const before = makeClient((method) => {
      if (method === 'clipboard.startImageUpload') {
        return failure('Relay connection lost')
      }
      throw new Error(`unexpected ${method}`)
    })
    const after = makeClient((method) => {
      if (method === 'clipboard.startImageUpload') {
        return ok('start', { uploadId: 'upload-2' })
      }
      if (method === 'clipboard.appendImageUploadChunk') {
        return ok('append', {})
      }
      return ok('commit', '/tmp/a.jpg')
    })
    const args = baseArgs({ client: before as unknown as RpcClient })
    mount(args)
    await act(async () => {
      await hook!.attachImage('library')
    })
    const failed = hook!.attachments[0]!
    act(() => {
      renderer!.update(createElement(Harness, { args: { ...args, client: after as unknown as RpcClient } }))
    })
    const callsBefore = before.calls.length
    let retried = false
    await act(async () => {
      retried = await retryNativeChatUpload(failed.id)
    })
    expect(retried).toBe(true)
    expect(before.calls.length).toBe(callsBefore)
    expect(after.calls.map((call) => call.method)).toContain('clipboard.commitImageUpload')
    expect(hook!.attachments[0]).toMatchObject({ id: failed.id, path: '/tmp/a.jpg' })
  })

  it('lets go of a failed photo\'s retry, and its bytes, when the chip store resets', async () => {
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    const client = makeClient((method) => {
      if (method === 'clipboard.startImageUpload') {
        return failure('Upload slot refused')
      }
      throw new Error(`unexpected ${method}`)
    })
    mount(baseArgs({ client: client as unknown as RpcClient }))
    await act(async () => {
      await hook!.attachImage('library')
    })
    const failed = hook!.attachments[0]!
    expect(canRetryNativeChatUpload(failed.id)).toBe(true)
    act(() => useNativeChatImageAttachmentsStore.getState().reset())
    expect(canRetryNativeChatUpload(failed.id)).toBe(false)
  })

  it('refuses a send tapped beside a failed photo, and writes nothing', async () => {
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    const client = makeClient((method) => {
      if (method === 'clipboard.startImageUpload') {
        return failure('Upload slot refused')
      }
      throw new Error(`unexpected ${method}`)
    })
    const onSendError = vi.fn()
    const baseSend = vi.fn().mockResolvedValue('accepted')
    mount(baseArgs({ client: client as unknown as RpcClient, onSendError, baseSend }))
    await act(async () => {
      await hook!.attachImage('library')
    })
    const before = client.calls.length
    let sent = true
    await act(async () => {
      sent = await hook!.sendNativeChat('look at this')
    })
    expect(sent).toBe(false)
    expect(onSendError).toHaveBeenCalledWith('Message not sent: a photo did not upload')
    expect(baseSend).not.toHaveBeenCalled()
    expect(client.calls.slice(before)).toEqual([])
    expect(hook!.attachments).toHaveLength(1)
  })
})
