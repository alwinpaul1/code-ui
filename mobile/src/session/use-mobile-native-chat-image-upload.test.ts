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
      videoFrameDeps: { signal?: AbortSignal }
    ) {
      capturedSignal = videoFrameDeps.signal
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
      videoFrameDeps: { onProgress?: (p: { done: number; total: number }) => void }
    ) {
      videoFrameDeps.onProgress?.({ done: 1, total: 20 })
      videoFrameDeps.onProgress?.({ done: 2, total: 20 })
    })
    const onVideoFrameExtractionProgress = vi.fn()
    mount(baseArgs({ showToast: vi.fn(), onVideoFrameExtractionProgress }))

    await act(async () => {
      await hook!.attachDocument()
    })

    expect(onVideoFrameExtractionProgress).toHaveBeenNthCalledWith(1, 'scope-1', { done: 1, total: 20 })
    expect(onVideoFrameExtractionProgress).toHaveBeenNthCalledWith(2, 'scope-1', { done: 2, total: 20 })
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
    pickDocumentsMock.mockImplementation(async function* () {
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
