import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

const pickDocumentsMock = vi.hoisted(() => vi.fn())
vi.mock('../platform/media-picker', () => ({ useMediaPicker: () => ({ pickImages: vi.fn() }) }))
vi.mock('./mobile-image-source-picker', () => ({
  pickMobileDocuments: pickDocumentsMock,
  pickMobileImageFiles: vi.fn()
}))

import type { RpcClient } from '../transport/rpc-client'
import {
  registerVideoFrameExtractionController,
  useNativeChatImageAttachmentsStore
} from './mobile-native-chat-image-attachments-store'
import {
  VideoFrameExtractionCancelledError,
  VideoFrameExtractionError
} from './mobile-video-frame-extractor'
import { useMobileNativeChatImageUpload } from './use-mobile-native-chat-image-upload'
import { makeClient, methodNotFound, ok } from './use-mobile-native-chat-image-attachments.test-support'

type Hook = ReturnType<typeof useMobileNativeChatImageUpload>
type Args = Parameters<typeof useMobileNativeChatImageUpload>[0]

function baseArgs(overrides: Partial<Args> & Pick<Args, 'showToast'>): Args {
  return {
    client: { sendRequest: vi.fn() } as unknown as RpcClient,
    activeHandleRef: { current: 'term-1' },
    getActiveWorktreeConnectionId: async () => null,
    connState: 'connected',
    scopeKey: 'scope-1',
    structuredNativeChat: false,
    onImagesUploaded: vi.fn(),
    ...overrides
  }
}

/** A client that actually finishes a plain (non-video) upload, via the
 *  single-frame fallback (methodNotFound on start, then a save that hands
 *  back a path) — so a picked PDF's for-await loop moves on to the NEXT
 *  picked item instead of throwing on an undefined RPC response. */
function documentClient() {
  return makeClient((method) =>
    method === 'clipboard.startImageUpload' ? methodNotFound('start') : ok('save', '/tmp/a.pdf')
  )
}

/** A spy that ALSO writes to the real store, mirroring
 *  `setVideoFrameExtractionProgress` (use-native-chat-attachment-scope-writers.ts) —
 *  a bare `vi.fn()` records calls but never touches
 *  `videoFrameExtractionByScope`, and the finally-clear this hook now does
 *  checks that real state (batch-guarded, so it never blanks a DIFFERENT
 *  pick's still-reading progress): a test whose callback is a no-op spy
 *  would see that guard always skip, since nothing it does is ever visible
 *  to the store (2026-09-27 review). */
function trackedOnVideoFrameExtractionProgress(): Args['onVideoFrameExtractionProgress'] {
  return vi.fn((scope, progress) => {
    useNativeChatImageAttachmentsStore.getState().updateVideoFrameExtraction((prev) => {
      if (progress === null) {
        if (!(scope in prev)) {
          return prev
        }
        const next = { ...prev }
        delete next[scope]
        return next
      }
      return { ...prev, [scope]: progress }
    })
  })
}

describe('useMobileNativeChatImageUpload — video-frame extraction', () => {
  let renderer: ReactTestRenderer | null = null
  let hook: Hook | null = null

  function Harness({ args }: { args: Args }): null {
    hook = useMobileNativeChatImageUpload(args)
    return null
  }

  function mount(args: Args): void {
    act(() => {
      renderer = create(createElement(Harness, { args }))
    })
  }

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    hook = null
    pickDocumentsMock.mockReset()
    // The extraction-active flag and its controller now live in the shared
    // store, not a per-instance ref, so a test that leaves one set (a mock
    // that never settles, say) would otherwise leak into the next
    // (2026-09-27 review).
    useNativeChatImageAttachmentsStore.getState().reset()
  })

  it('says nothing — no toast — when the user cancels reading frames', async () => {
    // oxlint-disable-next-line require-yield -- fails before any frame is ever yielded.
    pickDocumentsMock.mockImplementation(async function* () {
      throw new VideoFrameExtractionCancelledError()
    })
    const showToast = vi.fn()
    mount(baseArgs({ showToast }))

    await act(async () => {
      await hook!.attachDocument()
    })

    expect(showToast).not.toHaveBeenCalled()
  })

  it('falls back to the "too large" toast with the reason, when extraction itself fails', async () => {
    // oxlint-disable-next-line require-yield -- fails before any frame is ever yielded.
    pickDocumentsMock.mockImplementation(async function* () {
      throw new VideoFrameExtractionError('Unsupported codec')
    })
    const showToast = vi.fn()
    mount(baseArgs({ showToast }))

    await act(async () => {
      await hook!.attachDocument()
    })

    expect(showToast).toHaveBeenCalledExactlyOnceWith(
      // "Unsupported codec" (a raw native-shaped message) maps to a short,
      // generic reason rather than being repeated verbatim in the toast
      // (2026-09-27 review).
      'File too large to attach (18 MB max) — the video could not be read',
      1500
    )
  })

  it('aborts the extraction\'s own signal when cancelVideoFrameExtraction is called', async () => {
    let capturedSignal: AbortSignal | undefined
    // oxlint-disable-next-line require-yield -- captures the signal and hangs; no frame is ever yielded.
    pickDocumentsMock.mockImplementation(async function* (
      _launch: unknown,
      _createFile: unknown,
      videoFrameDeps: { onStart?: () => void; signal?: AbortSignal }
    ) {
      capturedSignal = videoFrameDeps.signal
      // The controller is only registered (so cancel has anything to reach)
      // once extraction really starts, mirroring pickVideoFrames's own onStart.
      videoFrameDeps.onStart?.()
      // Never resolves on its own; the test drives it via cancelVideoFrameExtraction.
      await new Promise(() => {})
    })
    mount(baseArgs({ showToast: vi.fn() }))

    let attachPromise: Promise<void> | null = null
    act(() => {
      attachPromise = hook!.attachDocument()
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(capturedSignal?.aborted).toBe(false)
    act(() => {
      hook!.cancelVideoFrameExtraction()
    })
    expect(capturedSignal?.aborted).toBe(true)
    void attachPromise
  })

  it('reports extraction progress for the active scope, then clears it once the attach settles', async () => {
    // oxlint-disable-next-line require-yield -- reports progress and returns; no frame is ever yielded.
    pickDocumentsMock.mockImplementation(async function* (
      _launch: unknown,
      _createFile: unknown,
      videoFrameDeps: { onStart?: () => void; onProgress?: (p: { done: number; total: number }) => void }
    ) {
      videoFrameDeps.onStart?.()
      videoFrameDeps.onProgress?.({ done: 1, total: 20 })
      videoFrameDeps.onProgress?.({ done: 2, total: 20 })
    })
    const onVideoFrameExtractionProgress = trackedOnVideoFrameExtractionProgress()
    mount(baseArgs({ showToast: vi.fn(), onVideoFrameExtractionProgress }))

    await act(async () => {
      await hook!.attachDocument()
    })

    const batch = expect.stringMatching(/^batch-\d+$/) as unknown as string
    // onStart fires first, with no count yet — something to show for the
    // whole ready-wait, not just from the first frame (2026-09-27 review).
    expect(onVideoFrameExtractionProgress).toHaveBeenNthCalledWith(1, 'scope-1', { batch, done: 0, total: null })
    expect(onVideoFrameExtractionProgress).toHaveBeenNthCalledWith(2, 'scope-1', { batch, done: 1, total: 20 })
    expect(onVideoFrameExtractionProgress).toHaveBeenNthCalledWith(3, 'scope-1', { batch, done: 2, total: 20 })
    // Cleared last, whatever the outcome — nothing is left reading forever.
    expect(onVideoFrameExtractionProgress).toHaveBeenLastCalledWith('scope-1', null)
  })

  it('clears the progress chip the moment reading finishes, before the attach itself has settled', async () => {
    // 2026-09-27 review: the chip and its cancel X used to stay up through
    // every frame's own upload, since the only clear was in `attachWith`'s
    // finally — reached only once the WHOLE attach (all uploads too) settles.
    const held = Promise.withResolvers<void>()
    // oxlint-disable-next-line require-yield -- reports the last progress, then hangs; no frame is ever yielded.
    pickDocumentsMock.mockImplementation(async function* (
      _launch: unknown,
      _createFile: unknown,
      videoFrameDeps: { onProgress?: (p: { done: number; total: number }) => void }
    ) {
      videoFrameDeps.onProgress?.({ done: 1, total: 1 })
      await held.promise
    })
    const onVideoFrameExtractionProgress = vi.fn()
    mount(baseArgs({ showToast: vi.fn(), onVideoFrameExtractionProgress }))

    let attachPromise: Promise<void> | null = null
    act(() => {
      attachPromise = hook!.attachDocument()
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    // Cleared already — the mock is still hanging inside the pick, so the
    // whole attach has not settled yet.
    expect(onVideoFrameExtractionProgress).toHaveBeenLastCalledWith('scope-1', null)

    held.resolve()
    await act(async () => {
      await attachPromise
    })
  })

  it('refuses a second video while one is still reading, from a second attach', async () => {
    // 2026-09-27 review: a second attach used to overwrite the abort
    // controller (so cancel could only ever reach the newer one) and both
    // wrote the same scope's single progress slot. Fixed by moving the
    // refusal itself into onStart (below the picker having actually found a
    // video), not a pre-pick check — the mock reflects that: it only hangs
    // once onStart says it may.
    const held = Promise.withResolvers<void>()
    // oxlint-disable-next-line require-yield -- hangs once permitted, or returns immediately if refused; no frame is ever yielded.
    pickDocumentsMock.mockImplementation(async function* (
      _launch: unknown,
      _createFile: unknown,
      videoFrameDeps: { onStart?: () => boolean }
    ) {
      if (!videoFrameDeps.onStart?.()) {
        return
      }
      await held.promise
    })
    const showToast = vi.fn()
    mount(baseArgs({ showToast }))

    let firstAttach: Promise<void> | null = null
    act(() => {
      firstAttach = hook!.attachDocument()
    })
    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      await hook!.attachDocument()
    })

    expect(pickDocumentsMock).toHaveBeenCalledTimes(2)
    expect(showToast).toHaveBeenCalledExactlyOnceWith('Already reading a video — wait for it to finish', 1500)

    held.resolve()
    await act(async () => {
      await firstAttach
    })
  })

  // P6 (2026-09-27 review, item 1): a PDF attach must not be refused just
  // because some OTHER pick's video happens to be reading in this scope —
  // the old guard checked this before the picker even opened, so it refused
  // a pick that turned out to hold no video at all.
  it('P6: allows a plain document attach while an unrelated video is being read in the same scope', async () => {
    // Simulate an already-active, unrelated read — as if a previous
    // attachDocument() call's video were still going.
    registerVideoFrameExtractionController('scope-1', new AbortController())
    pickDocumentsMock.mockImplementation(async function* () {
      yield { base64: 'AAAA', uri: 'file:///a.pdf', name: 'a.pdf' }
    })
    const showToast = vi.fn()
    const onImagesUploaded = vi.fn()
    mount(baseArgs({ client: documentClient() as unknown as RpcClient, showToast, onImagesUploaded }))

    await act(async () => {
      await hook!.attachDocument()
    })

    expect(showToast).not.toHaveBeenCalled()
    expect(onImagesUploaded).toHaveBeenCalledExactlyOnceWith(
      'scope-1',
      expect.arrayContaining([expect.objectContaining({ name: 'a.pdf' })])
    )
  })

  // P11 (2026-09-27 review, item 2): pick 2's video starts reading (and
  // registers the controller its own cancel X reaches) while pick 1's PDF is
  // still uploading. Pick 1 only reaches its OWN video afterward, and must
  // be refused (a different pick's video is already reading) rather than
  // silently taking over pick 2's controller and cancel button — and pick
  // 1's own attachWith settling (its PDF done, its video refused) must not
  // blank pick 2's still-reading progress chip out of the store either.
  it('P11: an overlapping pick that only reaches its own video after a second pick already started reading does not steal that pick\'s controller or blank its progress', async () => {
    const held1 = Promise.withResolvers<void>()
    const held2 = Promise.withResolvers<void>()
    const pick2Started = Promise.withResolvers<void>()
    let signal2: AbortSignal | undefined

    pickDocumentsMock.mockImplementationOnce(async function* (
      _launch: unknown,
      _createFile: unknown,
      deps: { onStart?: () => boolean }
    ) {
      yield { base64: 'AAAA', uri: 'file:///a.pdf', name: 'a.pdf' }
      // Reproduces "pick 2 started while pick 1's PDF uploads": pick 1 does
      // not even reach its own video until pick 2 has already registered.
      await pick2Started.promise
      if (!deps.onStart?.()) {
        return
      }
      await held1.promise
    })
    // oxlint-disable-next-line require-yield -- captures the signal, hangs once permitted, or returns immediately if refused; no frame is ever yielded.
    pickDocumentsMock.mockImplementationOnce(async function* (
      _launch: unknown,
      _createFile: unknown,
      deps: { onStart?: () => boolean; signal?: AbortSignal }
    ) {
      signal2 = deps.signal
      if (!deps.onStart?.()) {
        return
      }
      pick2Started.resolve()
      await held2.promise
    })
    const showToast = vi.fn()
    const onVideoFrameExtractionProgress = trackedOnVideoFrameExtractionProgress()
    mount(baseArgs({ client: documentClient() as unknown as RpcClient, showToast, onVideoFrameExtractionProgress }))

    let pick1: Promise<void> | null = null
    act(() => {
      pick1 = hook!.attachDocument()
    })
    let pick2: Promise<void> | null = null
    act(() => {
      pick2 = hook!.attachDocument()
    })
    await act(async () => {
      await pick2Started.promise
      await Promise.resolve()
      await Promise.resolve()
    })

    // Pick 1's video, reached only once pick 2 is already the active read, is refused.
    expect(showToast).toHaveBeenCalledExactlyOnceWith('Already reading a video — wait for it to finish', 1500)

    // The X on screen belongs to pick 2's read; it must still reach pick 2's
    // own controller, not one pick 1's later (refused) attempt overwrote.
    act(() => {
      hook!.cancelVideoFrameExtraction()
    })
    expect(signal2?.aborted).toBe(true)

    // Pick 1's own attach settles now (its refused video yielded nothing, so
    // nothing here throws) — its finally must not blank pick 2's own,
    // genuinely still-reading progress out of the store from under it.
    await act(async () => {
      await pick1
    })
    expect(useNativeChatImageAttachmentsStore.getState().videoFrameExtractionByScope['scope-1']).toMatchObject({
      done: 0,
      total: null
    })

    held1.resolve()
    held2.resolve()
    await act(async () => {
      await Promise.all([pick1, pick2])
    })
  })

  // 2026-09-27 review: the controller used to live in a `useRef` on this
  // hook's own instance. A composer remount mid-read (a tab revisited while
  // a video is still being read) gets a fresh hook instance — and used to
  // get a fresh, empty ref — so the progress chip's cancel button, which
  // reads whatever `cancelVideoFrameExtraction` the CURRENT mount hands it,
  // could no longer reach the read the earlier mount started. The controller
  // now lives in the store, keyed by scope, so any mount's cancel reaches it.
  it('after the composer remounts mid-read, the progress chip\'s cancel still stops the read', async () => {
    let capturedSignal: AbortSignal | undefined
    // oxlint-disable-next-line require-yield -- captures the signal and hangs; no frame is ever yielded.
    pickDocumentsMock.mockImplementation(async function* (
      _launch: unknown,
      _createFile: unknown,
      videoFrameDeps: { onStart?: () => void; signal?: AbortSignal }
    ) {
      capturedSignal = videoFrameDeps.signal
      videoFrameDeps.onStart?.()
      await new Promise(() => {})
    })
    mount(baseArgs({ showToast: vi.fn() }))

    act(() => {
      void hook!.attachDocument()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(capturedSignal?.aborted).toBe(false)

    // The tab this composer belongs to was left and come back to: a fresh
    // mount, same scope, with its own fresh `useRef`s (had this hook still
    // used one) — none of which ever saw the earlier mount's controller.
    act(() => {
      renderer?.unmount()
    })
    mount(baseArgs({ showToast: vi.fn() }))

    act(() => {
      hook!.cancelVideoFrameExtraction()
    })

    expect(capturedSignal?.aborted).toBe(true)
  })

  it('allows a new video attach once the previous one\'s reading has fully cleared, including a cancel', async () => {
    // oxlint-disable-next-line require-yield -- cancelled immediately; no frame is ever yielded.
    pickDocumentsMock.mockImplementation(async function* (
      _launch: unknown,
      _createFile: unknown,
      videoFrameDeps: { onStart?: () => boolean }
    ) {
      videoFrameDeps.onStart?.()
      throw new VideoFrameExtractionCancelledError()
    })
    const showToast = vi.fn()
    mount(baseArgs({ showToast }))

    await act(async () => {
      await hook!.attachDocument()
    })
    await act(async () => {
      await hook!.attachDocument()
    })

    expect(pickDocumentsMock).toHaveBeenCalledTimes(2)
    // Neither attempt was ever refused as "a video is already reading" — the
    // first one's controller (and the store's slice) cleared with it.
    expect(showToast).not.toHaveBeenCalled()
  })

  it('allows a new video attach once the previous one\'s reading finished normally, not just once its uploads did too', async () => {
    // 2026-09-27 review: the controller now clears at reading's own end
    // (done === total), not only in attachWith's finally once every frame's
    // upload has ALSO landed — a second attach in that gap must succeed.
    const held = Promise.withResolvers<void>()
    // oxlint-disable-next-line require-yield -- reports the last progress, then hangs; no frame is ever yielded.
    pickDocumentsMock.mockImplementationOnce(async function* (
      _launch: unknown,
      _createFile: unknown,
      videoFrameDeps: { onStart?: () => boolean; onProgress?: (p: { done: number; total: number }) => void }
    ) {
      if (!videoFrameDeps.onStart?.()) {
        return
      }
      videoFrameDeps.onProgress?.({ done: 1, total: 1 })
      // Reading is done, but this pick's own upload of that one frame is
      // still hanging — attachWith has not settled yet.
      await held.promise
    })
    // oxlint-disable-next-line require-yield -- cancelled immediately, or returns immediately if refused; no frame is ever yielded.
    pickDocumentsMock.mockImplementationOnce(async function* (
      _launch: unknown,
      _createFile: unknown,
      videoFrameDeps: { onStart?: () => boolean }
    ) {
      if (!videoFrameDeps.onStart?.()) {
        return
      }
      throw new VideoFrameExtractionCancelledError()
    })
    const showToast = vi.fn()
    mount(baseArgs({ showToast }))

    let firstAttach: Promise<void> | null = null
    act(() => {
      firstAttach = hook!.attachDocument()
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      await hook!.attachDocument()
    })

    expect(pickDocumentsMock).toHaveBeenCalledTimes(2)
    expect(showToast).not.toHaveBeenCalled()

    held.resolve()
    await act(async () => {
      await firstAttach
    })
  })
})
