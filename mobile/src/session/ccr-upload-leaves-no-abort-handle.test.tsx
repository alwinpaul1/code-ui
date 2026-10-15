/**
 * A Claude tab's pick on the Anthropic lane holds an abort handle per picture while it goes up
 * (`nativeChatUploadAborts`, so the remove badge can call it back). Second review of the lane,
 * 2026-10-15: a picture Anthropic refused before upload (empty, over the cap, a 413) and one whose
 * bytes could not be read never gave theirs back, so the map grew with every such pick. The
 * selection's end now drops every handle it registered. A failed chip's retry holds one too, and a
 * store reset (which reuses chip ids from 1) left it running, so it could land on the next chip
 * to take its id.
 */
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../platform/media-picker', () => ({ useMediaPicker: () => ({ pickImages: vi.fn() }) }))
vi.mock('./mobile-image-source-picker', () => ({ pickMobileDocuments: vi.fn(), pickMobileImageFiles: vi.fn() }))

import { setCcrFileDiscardForTests } from './ccr-file-discard'
import { CCR_ATTACHMENT_TOO_LARGE, CcrFileUploadError, type CcrUploadedFile } from './ccr-file-upload'
import type { NativeChatAttachmentStore, NativeChatUploadLanded, PendingNativeChatImage } from './mobile-native-chat-image-attachment'
import { nativeChatUploadAborts, useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import { registerNativeChatUploadRetry, resetNativeChatUploadRetriesForTests, retryNativeChatUpload } from './mobile-native-chat-upload-retry'
import { useMobileNativeChatImageUpload } from './use-mobile-native-chat-image-upload'
import { useNativeChatAttachmentScopeWriters } from './use-native-chat-attachment-scope-writers'

const SCOPE = 'h\0w\0tab-1'
const toasts: string[] = []
let attach!: ReturnType<typeof useMobileNativeChatImageUpload>
let renderer: ReactTestRenderer | null = null

function Harness({ store }: { store: NativeChatAttachmentStore }): null {
  const writers = useNativeChatAttachmentScopeWriters(() => undefined)
  attach = useMobileNativeChatImageUpload({
    client: null,
    activeHandleRef: { current: null },
    getActiveWorktreeConnectionId: async () => null,
    connState: 'connected',
    scopeKey: SCOPE,
    structuredNativeChat: true,
    showToast: (message) => toasts.push(message),
    onImagesUploaded: writers.addUploadedImages,
    onImageUploading: writers.addUploadingImage,
    onUploadSettled: writers.settleUploads,
    onImageFailed: writers.markUploadFailed,
    anthropicStore: () => store
  })
  return null
}

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  toasts.length = 0
  setCcrFileDiscardForTests(null)
  resetNativeChatUploadRetriesForTests()
  useNativeChatImageAttachmentsStore.getState().reset()
})

async function attachThrough(store: NativeChatAttachmentStore, base64: string): Promise<void> {
  act(() => {
    renderer = create(createElement(Harness, { store }))
  })
  await act(async () => {
    await attach.attachImageBase64(base64, 'image/png')
  })
}

describe('a pick on the Anthropic lane that ends without a chip', () => {
  it('leaves no upload handle behind when Anthropic refuses the picture as too large', async () => {
    const store = vi.fn<NativeChatAttachmentStore>(async () => {
      throw new CcrFileUploadError(CCR_ATTACHMENT_TOO_LARGE, 'HTTP 413', true)
    })
    await attachThrough(store, 'iVBORw0KGgo=')
    expect(store).toHaveBeenCalledOnce()
    expect(toasts).toEqual([CCR_ATTACHMENT_TOO_LARGE])
    expect(useNativeChatImageAttachmentsStore.getState().byScope[SCOPE] ?? []).toEqual([])
    expect([...nativeChatUploadAborts.keys()]).toEqual([])
  })

  it('leaves no upload handle behind when the picture has no bytes to send', async () => {
    const store = vi.fn<NativeChatAttachmentStore>()
    await attachThrough(store, '')
    expect(store).not.toHaveBeenCalled()
    expect(useNativeChatImageAttachmentsStore.getState().byScope[SCOPE] ?? []).toEqual([])
    expect([...nativeChatUploadAborts.keys()]).toEqual([])
  })
})

describe('a failed chip retried just before the store resets', () => {
  const file: CcrUploadedFile = { fileId: 'file_011CRetry', fileName: 'r.pdf', isImage: false, accountId: 'acct-personal' }
  // The chip that takes the same id after the reset: a different picture, already landed.
  const next: PendingNativeChatImage = { id: 'img-1', path: '/tmp/next.png', previewUri: 'file:///next.png' }
  const chips = () => useNativeChatImageAttachmentsStore.getState().byScope[SCOPE] ?? []

  function retryThenReset() {
    const discarded: CcrUploadedFile[] = []
    setCcrFileDiscardForTests({ remove: async (f) => { discarded.push(f); return 200 }, log: () => undefined })
    useNativeChatImageAttachmentsStore.getState().update((prev) => ({ ...prev, [SCOPE]: [{ id: 'img-1', path: '', previewUri: 'file:///r.pdf', kind: 'file', name: 'r.pdf', failed: true }] }))
    let signal: AbortSignal | undefined
    let settle!: { land: (value: NativeChatUploadLanded) => void; fail: (error: unknown) => void }
    const onFailed = vi.fn()
    registerNativeChatUploadRetry('img-1', {
      scope: SCOPE,
      run: (given) => {
        signal = given
        return new Promise((resolve, reject) => { settle = { land: resolve, fail: reject } })
      },
      onFailed
    })
    let retried: Promise<boolean> = Promise.resolve(true)
    act(() => {
      retried = retryNativeChatUpload('img-1')
    })
    act(() => useNativeChatImageAttachmentsStore.getState().reset())
    useNativeChatImageAttachmentsStore.getState().update((prev) => ({ ...prev, [SCOPE]: [next] }))
    return { discarded, onFailed, retried, settle, aborted: () => signal?.aborted }
  }

  it('is called back by the reset, and a file it lands anyway is deleted, never put on the next chip with its id', async () => {
    const run = retryThenReset()
    expect(run.aborted()).toBe(true)
    run.settle.land({ path: '', previewUri: 'file:///r.pdf', anthropicFile: file })
    await act(async () => {
      expect(await run.retried).toBe(false)
    })
    expect(chips()).toEqual([next])
    expect(run.discarded).toEqual([file])
  })

  it('failing after the reset marks nothing failed and says nothing', async () => {
    const run = retryThenReset()
    run.settle.fail(new CcrFileUploadError('Upload failed', 'cancelled'))
    await act(async () => {
      expect(await run.retried).toBe(false)
    })
    expect(chips()).toEqual([next])
    expect(run.onFailed).not.toHaveBeenCalled()
  })
})
