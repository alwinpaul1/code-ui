/**
 * The edges of a Claude tab's attachments on the Anthropic lane (ccr-file-upload.ts), from the
 * lane's review of 2026-10-15: a file the server refuses as too large, a retry after the tab left
 * the lane, the banner's Retry on a message with no words, and a send with chips while the tab
 * has no send target (refused whole, with the target's own reason).
 */
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CCR_SEND_REFUSALS } from './use-ccr-composer-send'
import { CCR_ATTACHMENT_TOO_LARGE, CcrFileUploadError, uploadCcrFile, type CcrUploadedFile } from './ccr-file-upload'
import { uploadMobileNativeChatImages, type NativeChatAttachmentStore, type NativeChatUploadLanded } from './mobile-native-chat-image-attachment'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import { registerNativeChatUploadRetry, resetNativeChatUploadRetriesForTests, retryNativeChatUpload } from './mobile-native-chat-upload-retry'
import { retrySendFromComposer } from './native-chat-send-error-retry'
import { useNativeChatAnthropicSend, type NativeChatAnthropicAttachments } from './use-native-chat-anthropic-send'

const SCOPE = 'h\0w\0tab-1'
const auth = async () => ({ token: 'tok', organizationUuid: 'org-1' })
const file = (fileId: string): CcrUploadedFile => ({ fileId, fileName: 'r.pdf', isImage: false, accountId: 'acct-personal' })

afterEach(() => {
  resetNativeChatUploadRetriesForTests()
  useNativeChatImageAttachmentsStore.getState().reset()
})

describe('a file the server refuses as too large', () => {
  it('is refused as the phone refuses one past the cap, in the app words, so its chip offers no useless retry', async () => {
    const error = await uploadCcrFile({ auth, upload: async () => ({ status: 413, body: '' }) }, 'acct-personal', { base64: 'JVBERi0x', name: 'r.pdf' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(CcrFileUploadError)
    expect((error as CcrFileUploadError).refusedBeforeUpload).toBe(true)
    expect((error as CcrFileUploadError).userMessage).toBe(CCR_ATTACHMENT_TOO_LARGE)
  })

  it('a retry refused as too large takes the chip away instead of leaving it failed with another retry', async () => {
    useNativeChatImageAttachmentsStore.getState().update((prev) => ({ ...prev, [SCOPE]: [{ id: 'img-3', path: '', previewUri: 'file:///r.pdf', kind: 'file', name: 'r.pdf', failed: true }] }))
    const onFailed = vi.fn()
    registerNativeChatUploadRetry('img-3', { scope: SCOPE, run: async () => { throw new CcrFileUploadError(CCR_ATTACHMENT_TOO_LARGE, 'HTTP 413', true) }, onFailed })
    expect(await retryNativeChatUpload('img-3')).toBe(false)
    expect(useNativeChatImageAttachmentsStore.getState().byScope[SCOPE] ?? []).toEqual([])
    expect(onFailed).toHaveBeenCalledOnce()
    expect(await retryNativeChatUpload('img-3')).toBe(false)
  })
})

describe('a failed chip retried later', () => {
  async function failedPick(store: NativeChatAttachmentStore, live: () => { client: null; getConnectionId: () => Promise<string | null>; store: (() => NativeChatAttachmentStore | null) | null }) {
    let retry: ((signal?: AbortSignal) => Promise<NativeChatUploadLanded>) | null = null
    await uploadMobileNativeChatImages('library', {
      client: null,
      getConnectionId: async () => null,
      store,
      retryConnection: live,
      pickImages: async () => [{ base64: 'JVBERi0x', uri: 'file:///r.pdf', name: 'r.pdf', mimeType: 'application/pdf' }],
      onImageFailed: (_image, _error, again) => {
        retry = again
      }
    }).catch(() => undefined)
    return retry!
  }

  it('goes up through the upload the tab has NOW, not the one it had at the pick', async () => {
    const atPick = vi.fn<NativeChatAttachmentStore>(async () => { throw new CcrFileUploadError('Upload failed', 'HTTP 500') })
    const now = vi.fn<NativeChatAttachmentStore>(async () => ({ path: '', anthropicFile: file('file_011CNow') }))
    const retry = await failedPick(atPick, () => ({ client: null, getConnectionId: async () => null, store: () => now }))
    await expect(retry()).resolves.toEqual({ path: '', anthropicFile: file('file_011CNow'), previewUri: 'file:///r.pdf' })
    expect(atPick).toHaveBeenCalledOnce()
    expect(now).toHaveBeenCalledOnce()
  })

  it('goes to the desktop once the tab has left the Anthropic lane, never through the old upload', async () => {
    const atPick = vi.fn<NativeChatAttachmentStore>(async () => { throw new CcrFileUploadError('Upload failed', 'HTTP 500') })
    const retry = await failedPick(atPick, () => ({ client: null, getConnectionId: async () => null, store: null }))
    await expect(retry()).rejects.toThrow('Not connected to the desktop')
    expect(atPick).toHaveBeenCalledOnce()
  })
})

describe("the error banner's Retry", () => {
  it('sends again a message that had attachments and no words', () => {
    const send = vi.fn(async () => true)
    const clear = vi.fn()
    retrySendFromComposer('', send, clear, 1)
    expect(send).toHaveBeenCalledExactlyOnceWith('')
    expect(clear).toHaveBeenCalledOnce()
  })

  it('still does nothing with no words and no attachments', () => {
    const send = vi.fn(async () => true)
    retrySendFromComposer('  ', send, undefined, 0)
    expect(send).not.toHaveBeenCalled()
  })
})

describe('a send with chips while the tab has no send target yet', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('sends nothing, so the words never go without their chips, and says the target\'s own reason', async () => {
    useNativeChatImageAttachmentsStore.getState().update((prev) => ({ ...prev, [SCOPE]: [{ id: 'img-1', path: '', previewUri: 'file:///a.jpg', anthropicFile: { ...file('file_011CA'), isImage: true } }] }))
    const laneSend = vi.fn<NativeChatAnthropicAttachments['send']>(async () => 'accepted')
    const lane: NativeChatAnthropicAttachments = { store: () => null, account: () => ({ refused: CCR_SEND_REFUSALS.unsettled }), send: laneSend }
    const onSendError = vi.fn()
    const take = vi.fn()
    let send!: (text: string) => Promise<boolean>
    function Harness(): null {
      send = useNativeChatAnthropicSend({ anthropic: lane, scopeKey: SCOPE, onSendError, takeSentAttachments: take, restoreSentAttachments: vi.fn() })
      return null
    }
    act(() => {
      renderer = create(createElement(Harness))
    })
    let sent = true
    await act(async () => {
      sent = await send('look at this')
    })
    expect(sent).toBe(false)
    expect(laneSend).not.toHaveBeenCalled()
    expect(take).not.toHaveBeenCalled()
    expect(onSendError).toHaveBeenCalledExactlyOnceWith(CCR_SEND_REFUSALS.unsettled)
  })
})
