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
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import {
  VideoFrameExtractionCancelledError,
  VideoFrameExtractionError
} from './mobile-video-frame-extractor'
import { useMobileNativeChatImageUpload } from './use-mobile-native-chat-image-upload'

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
    const onVideoFrameExtractionProgress = vi.fn()
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

  it('refuses a second document attach while one is still reading a video\'s frames', async () => {
    // 2026-09-27 review: a second attach used to overwrite the abort
    // controller (so cancel could only ever reach the newer one) and both
    // wrote the same scope's single progress slot.
    const held = Promise.withResolvers<void>()
    // oxlint-disable-next-line require-yield -- hangs mid-extraction; no frame is ever yielded.
    pickDocumentsMock.mockImplementation(async function* (
      _launch: unknown,
      _createFile: unknown,
      videoFrameDeps: { onStart?: () => void }
    ) {
      // The guard checks the store's "a video is really being read" slice,
      // which is only set once a video is recognized — matching that here,
      // or this mock would never trip the guard at all (2026-09-27 review).
      videoFrameDeps.onStart?.()
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

    expect(pickDocumentsMock).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledExactlyOnceWith('Already reading a video — wait for it to finish', 1500)

    held.resolve()
    await act(async () => {
      await firstAttach
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

  it('allows a new document attach once the previous one has fully settled', async () => {
    // oxlint-disable-next-line require-yield -- cancelled immediately; no frame is ever yielded.
    pickDocumentsMock.mockImplementation(async function* () {
      throw new VideoFrameExtractionCancelledError()
    })
    mount(baseArgs({ showToast: vi.fn() }))

    await act(async () => {
      await hook!.attachDocument()
    })
    await act(async () => {
      await hook!.attachDocument()
    })

    expect(pickDocumentsMock).toHaveBeenCalledTimes(2)
  })
})
