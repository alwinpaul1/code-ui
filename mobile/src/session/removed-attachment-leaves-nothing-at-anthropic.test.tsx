/**
 * A Claude tab's attachment on the Anthropic lane (ccr-file-upload.ts), taken out of the strip:
 * review of the lane, 2026-10-15. Removing a chip, or leaving the chat, while its file went up let
 * the request run on, and a file that landed for a removed chip stayed at Anthropic with nothing
 * referencing it. The upload is now called back, and a file id that comes back for a removed chip
 * is deleted with the same account, best effort, with one log line that carries no token.
 */
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCcrFileDiscardForTests } from './ccr-file-discard'
import { CcrFileUploadError, deleteCcrFile, type CcrUploadedFile } from './ccr-file-upload'
import type { CcrSendTarget } from './ccr-session-cache'
import { uploadMobileNativeChatImages, type NativeChatUploadLanded } from './mobile-native-chat-image-attachment'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import { registerNativeChatUploadRetry, resetNativeChatUploadRetriesForTests, retryNativeChatUpload } from './mobile-native-chat-upload-retry'
import { ccrAttachmentLane, useCcrAttachmentLane, type CcrUploadForSession } from './use-ccr-attachment-lane'
import { useNativeChatAttachmentScopeWriters } from './use-native-chat-attachment-scope-writers'

const SCOPE = 'h\0w\0tab-1'
const TOKEN = 'sk-ant-oat01-secret-token-value'
const target = (): CcrSendTarget => ({ kind: 'target', accountId: 'acct-personal', sessionId: 'cse_01TAB' })
const landedFile = (fileId: string): CcrUploadedFile => ({ fileId, fileName: 'report.pdf', isImage: false, accountId: 'acct-personal' })

/** An upload that waits until released, or rejects when its signal aborts (as the device's does). */
function pendingUpload(options: { ignoreAbort?: boolean } = {}) {
  const signals: AbortSignal[] = []
  let release: (file: CcrUploadedFile) => void = () => undefined
  const upload = vi.fn<CcrUploadForSession>((_accountId, _sessionId, _file, signal) => {
    signals.push(signal!)
    return new Promise<CcrUploadedFile>((resolve, reject) => {
      release = resolve
      if (!options.ignoreAbort) {
        signal?.addEventListener('abort', () => reject(new CcrFileUploadError('Upload failed', 'cancelled')))
      }
    })
  })
  return { upload, signals, release: (file: CcrUploadedFile) => release(file) }
}

let writers!: ReturnType<typeof useNativeChatAttachmentScopeWriters>
let renderer: ReactTestRenderer | null = null
function Writers(): null {
  writers = useNativeChatAttachmentScopeWriters(() => undefined)
  return null
}

const discarded: CcrUploadedFile[] = []
const logged: string[] = []
beforeEach(() => {
  setCcrFileDiscardForTests({ remove: async (file) => { discarded.push(file); return 200 }, log: (line) => logged.push(line) })
  act(() => {
    renderer = create(createElement(Writers))
  })
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  setCcrFileDiscardForTests(null)
  discarded.length = 0
  logged.length = 0
  resetNativeChatUploadRetriesForTests()
  useNativeChatImageAttachmentsStore.getState().reset()
})

const chips = () => useNativeChatImageAttachmentsStore.getState().byScope[SCOPE] ?? []
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

/** A document picked on the lane, its chip drawn through the real strip writers. */
function pick(upload: CcrUploadForSession): Promise<unknown> {
  const lane = ccrAttachmentLane({ enabled: true, resolveTarget: target, send: async () => 'accepted', upload })!
  return uploadMobileNativeChatImages('library', {
    client: null,
    getConnectionId: async () => null,
    store: lane.store()!,
    pickImages: async () => [{ base64: 'JVBERi0x', uri: 'file:///r.pdf', name: 'report.pdf', mimeType: 'application/pdf' }],
    onImageStart: (image, cancel) => writers.addUploadingImage(SCOPE, { ...image, batch: 'b1' }, cancel),
    onImageUploaded: (image) => writers.addUploadedImages(SCOPE, [{ ...image, batch: 'b1' }]),
    onImageFailed: (image, error, retry) => writers.markUploadFailed(SCOPE, { ...image, batch: 'b1' }, retry)
  }).catch((error: unknown) => error)
}

describe('a Claude tab attachment taken out of the strip', () => {
  it('removing a chip while its file goes up to Anthropic calls the upload back, and no chip comes back', async () => {
    const { upload, signals } = pendingUpload()
    const picking = pick(upload)
    await flush()
    expect(chips()).toHaveLength(1)
    expect(signals[0]!.aborted).toBe(false)
    act(() => writers.removeScopeAttachment(SCOPE, chips()[0]!.id))
    expect(signals[0]!.aborted).toBe(true)
    await act(async () => {
      await picking
    })
    expect(chips()).toEqual([])
    expect(discarded).toEqual([])
  })

  it('a file that lands for a chip removed while it went up is deleted, and its chip stays out', async () => {
    const { upload, release } = pendingUpload({ ignoreAbort: true })
    const picking = pick(upload)
    await flush()
    act(() => writers.removeScopeAttachment(SCOPE, chips()[0]!.id))
    release(landedFile('file_011CLate'))
    await act(async () => {
      await picking
    })
    expect(chips()).toEqual([])
    expect(discarded).toEqual([landedFile('file_011CLate')])
  })

  it('removing a chip whose file already landed deletes that file with the same account, and logs it without a token', async () => {
    const { upload, release } = pendingUpload()
    const picking = pick(upload)
    await flush()
    release(landedFile('file_011CLanded'))
    await act(async () => {
      await picking
    })
    expect(chips()[0]?.anthropicFile).toEqual(landedFile('file_011CLanded'))
    act(() => writers.removeScopeAttachment(SCOPE, chips()[0]!.id))
    await flush()
    expect(discarded).toEqual([landedFile('file_011CLanded')])
    expect(logged).toEqual(['[ccr-upload] attachment …Landed no chip references was deleted'])
  })

  it('a failed delete is logged with its cause and nothing else happens', async () => {
    setCcrFileDiscardForTests({ remove: async () => { throw new Error('network down') }, log: (line) => logged.push(line) })
    useNativeChatImageAttachmentsStore.getState().update((prev) => ({ ...prev, [SCOPE]: [{ id: 'img-1', path: '', previewUri: 'file:///r.pdf', kind: 'file', name: 'report.pdf', anthropicFile: landedFile('file_011CGone') }] }))
    act(() => writers.removeScopeAttachment(SCOPE, 'img-1'))
    await flush()
    expect(chips()).toEqual([])
    expect(logged).toEqual(['[ccr-upload] attachment …1CGone no chip references could not be deleted: network down'])
  })

  it('removing a chip while its retry goes up calls the retry back, and a file it lands anyway is deleted', async () => {
    useNativeChatImageAttachmentsStore.getState().update((prev) => ({ ...prev, [SCOPE]: [{ id: 'img-5', path: '', previewUri: 'file:///r.pdf', kind: 'file', name: 'report.pdf', failed: true }] }))
    let signal: AbortSignal | undefined
    let land: (value: NativeChatUploadLanded) => void = () => undefined
    registerNativeChatUploadRetry('img-5', {
      scope: SCOPE,
      run: (given) => {
        signal = given
        return new Promise((resolve) => { land = resolve })
      },
      onFailed: () => undefined
    })
    let retried: Promise<boolean> = Promise.resolve(false)
    act(() => {
      retried = retryNativeChatUpload('img-5')
    })
    act(() => writers.removeScopeAttachment(SCOPE, 'img-5'))
    expect(signal?.aborted).toBe(true)
    land({ path: '', previewUri: 'file:///r.pdf', anthropicFile: landedFile('file_011CRetry') })
    await act(async () => {
      expect(await retried).toBe(false)
    })
    expect(chips()).toEqual([])
    expect(discarded).toEqual([landedFile('file_011CRetry')])
  })

  it('leaving the chat calls back an upload still going', async () => {
    const { upload, signals } = pendingUpload()
    let lane: ReturnType<typeof useCcrAttachmentLane> = null
    function Lane(): null {
      lane = useCcrAttachmentLane({ active: true, switchOn: true, resolveTarget: target, send: async () => 'accepted', upload })
      return null
    }
    let mounted: ReactTestRenderer | null = null
    act(() => {
      mounted = create(createElement(Lane))
    })
    const going = lane!.store()!({ base64: 'JVBERi0x', name: 'report.pdf' }).catch((error: unknown) => error)
    await flush()
    expect(signals[0]!.aborted).toBe(false)
    act(() => mounted!.unmount())
    expect(signals[0]!.aborted).toBe(true)
    expect(await going).toBeInstanceOf(CcrFileUploadError)
  })
})

describe('deleting an uploaded file', () => {
  it('sends the Files API DELETE with the uploading account, reading the sign-in again once on a 401', async () => {
    const remove = vi.fn(async () => ({ status: remove.mock.calls.length === 1 ? 401 : 200 }))
    const auth = vi.fn(async (_accountId: string, fresh: boolean) => ({ token: fresh ? `${TOKEN}-fresh` : TOKEN, organizationUuid: 'org-1' }))
    expect(await deleteCcrFile({ auth, remove }, 'acct-personal', 'file_011CX')).toBe(200)
    expect(auth.mock.calls).toEqual([['acct-personal', false], ['acct-personal', true]])
    expect(remove).toHaveBeenLastCalledWith({ url: 'https://api.anthropic.com/v1/files/file_011CX', headers: expect.objectContaining({ Authorization: `Bearer ${TOKEN}-fresh`, 'anthropic-beta': 'files-api-2025-04-14,oauth-2025-04-20' }) })
  })
})
