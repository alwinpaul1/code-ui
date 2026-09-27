import { afterEach, describe, expect, it, vi } from 'vitest'

// The real modules reach react-native's Flow-typed entry, which vitest's
// transform cannot parse — mocked at this exact boundary, matching how
// `mobile-video-frame-picker.ts` treats this same file as the seam. Every
// mutable fixture `vi.mock`'s factories close over is declared through
// `vi.hoisted`, since the factories themselves are hoisted above ordinary
// top-level `const`s in this file.
const { statusListeners, fakePlayer, createVideoPlayer } = vi.hoisted(() => {
  const listeners: Array<(payload: { status: string; error?: { message: string } }) => void> = []
  const player = {
    status: 'loading' as string,
    duration: 0,
    addListener: vi.fn(
      (_event: string, listener: (payload: { status: string; error?: { message: string } }) => void) => {
        listeners.push(listener)
        return {
          remove: vi.fn(() => {
            const index = listeners.indexOf(listener)
            if (index !== -1) {
              listeners.splice(index, 1)
            }
          })
        }
      }
    ),
    generateThumbnailsAsync: vi.fn(),
    release: vi.fn()
  }
  return { statusListeners: listeners, fakePlayer: player, createVideoPlayer: vi.fn(() => player) }
})
vi.mock('expo-video', () => ({ createVideoPlayer }))

type FakeContext = {
  resize: ReturnType<typeof vi.fn>
  renderAsync: ReturnType<typeof vi.fn>
  release: ReturnType<typeof vi.fn>
}
type FakeRendered = { saveAsync: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }

const { manipulate, fixtures } = vi.hoisted(() => {
  const state = {
    nextRenderedResults: [] as Array<{ base64?: string; uri?: string } | Error>,
    contexts: [] as FakeContext[],
    rendered: [] as FakeRendered[]
  }
  const manipulateMock = vi.fn(() => {
    const context: FakeContext = {
      resize: vi.fn(),
      release: vi.fn(),
      renderAsync: vi.fn(async () => {
        const outcome = state.nextRenderedResults.shift()
        const renderedImage: FakeRendered = {
          saveAsync: vi.fn(async () => {
            if (outcome instanceof Error) {
              throw outcome
            }
            return outcome ?? { base64: 'default' }
          }),
          release: vi.fn()
        }
        state.rendered.push(renderedImage)
        return renderedImage
      })
    }
    state.contexts.push(context)
    return context
  })
  return { manipulate: manipulateMock, fixtures: state }
})
vi.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate },
  SaveFormat: { JPEG: 'jpeg' }
}))

const { deletedFileUris, FsFile } = vi.hoisted(() => {
  const deleted: string[] = []
  return {
    deletedFileUris: deleted,
    // A real constructor function, not an arrow: production code calls
    // `new FsFile(uri)`, which an arrow function cannot serve as.
    FsFile: vi.fn(function FsFile(this: { delete(): void }, uri: string) {
      this.delete = () => {
        deleted.push(uri)
      }
    })
  }
})
vi.mock('expo-file-system', () => ({ File: FsFile }))

import { VideoFrameExtractionError } from './mobile-video-frame-extractor'
import { createNativeVideoFramePlayer, encodeNativeVideoFrame } from './mobile-video-frame-player'

function reset(): void {
  statusListeners.length = 0
  fakePlayer.status = 'loading'
  fakePlayer.duration = 0
  createVideoPlayer.mockClear()
  fakePlayer.addListener.mockClear()
  fakePlayer.generateThumbnailsAsync.mockClear()
  fakePlayer.release.mockClear()
  manipulate.mockClear()
  fixtures.contexts = []
  fixtures.rendered = []
  fixtures.nextRenderedResults = []
  deletedFileUris.length = 0
}

describe('createNativeVideoFramePlayer — waitUntilReady', () => {
  afterEach(() => reset())

  it('resolves at once when the player is already readyToPlay', async () => {
    fakePlayer.status = 'readyToPlay'
    const player = createNativeVideoFramePlayer('file:///clip.mp4')
    await expect(player.waitUntilReady()).resolves.toBeUndefined()
    expect(fakePlayer.addListener).not.toHaveBeenCalled()
  })

  it('rejects at once when the player already reports its error status', async () => {
    fakePlayer.status = 'error'
    const player = createNativeVideoFramePlayer('file:///bad.mp4')
    await expect(player.waitUntilReady()).rejects.toBeInstanceOf(VideoFrameExtractionError)
    expect(fakePlayer.addListener).not.toHaveBeenCalled()
  })

  it('resolves once the statusChange listener reports readyToPlay, and removes itself', async () => {
    const player = createNativeVideoFramePlayer('file:///clip.mp4')
    const waiting = player.waitUntilReady()
    expect(statusListeners).toHaveLength(1)
    statusListeners[0]!({ status: 'loading' })
    statusListeners[0]!({ status: 'readyToPlay' })
    await expect(waiting).resolves.toBeUndefined()
    expect(statusListeners).toHaveLength(0)
  })

  it('rejects with the native error message once the listener reports the error status', async () => {
    const player = createNativeVideoFramePlayer('file:///bad.mp4')
    const waiting = player.waitUntilReady()
    statusListeners[0]!({ status: 'error', error: { message: 'Source error' } })
    await expect(waiting).rejects.toThrow('Source error')
    expect(statusListeners).toHaveLength(0)
  })

  it('reads duration and forwards generateThumbnails through to the native call, capped by maxEdge', async () => {
    fakePlayer.status = 'readyToPlay'
    fakePlayer.duration = 12.5
    fakePlayer.generateThumbnailsAsync.mockResolvedValue(['thumb'])
    const player = createNativeVideoFramePlayer('file:///clip.mp4')
    expect(player.duration).toBe(12.5)
    const result = await player.generateThumbnails([1, 2], 320)
    expect(fakePlayer.generateThumbnailsAsync).toHaveBeenCalledWith([1, 2], { maxWidth: 320, maxHeight: 320 })
    expect(result).toEqual(['thumb'])
  })

  it('releases the underlying player', () => {
    const player = createNativeVideoFramePlayer('file:///clip.mp4')
    player.release()
    expect(fakePlayer.release).toHaveBeenCalledOnce()
  })
})

describe('encodeNativeVideoFrame', () => {
  afterEach(() => reset())

  const thumbnail = { width: 1280, height: 720, release: vi.fn() }

  it('renders the frame twice — full quality, then a small preview — and returns both base64 strings', async () => {
    fixtures.nextRenderedResults = [{ base64: 'FULL' }, { base64: 'PREVIEW' }]
    const result = await encodeNativeVideoFrame(thumbnail, 0.6)
    expect(result).toEqual({ base64: 'FULL', previewBase64: 'PREVIEW' })
    // Two independent manipulation contexts, not one reused for both sizes.
    expect(manipulate).toHaveBeenCalledTimes(2)
  })

  it('deletes ImageManipulator\'s own cache file for both renders once their base64 is read', async () => {
    // 2026-09-27 review: `.release()` frees the native image reference, not
    // the JPEG file `saveAsync` wrote to cacheDir/ImageManipulator — twenty
    // frames' worth of those, per video, were never cleaned up at all.
    fixtures.nextRenderedResults = [
      { base64: 'FULL', uri: 'file:///cache/ImageManipulator/full.jpg' },
      { base64: 'PREVIEW', uri: 'file:///cache/ImageManipulator/preview.jpg' }
    ]
    await encodeNativeVideoFrame(thumbnail, 0.6)
    expect(deletedFileUris).toEqual([
      'file:///cache/ImageManipulator/full.jpg',
      'file:///cache/ImageManipulator/preview.jpg'
    ])
  })

  it('resizes only the preview render, to fit within the preview edge, aspect preserved', async () => {
    fixtures.nextRenderedResults = [{ base64: 'FULL' }, { base64: 'PREVIEW' }]
    await encodeNativeVideoFrame({ width: 1280, height: 640, release: vi.fn() }, 0.6)
    expect(fixtures.contexts[0]!.resize).not.toHaveBeenCalled()
    // 1280x640 fit within 160 -> longest edge (1280) scales to 160, height halves to 80.
    expect(fixtures.contexts[1]!.resize).toHaveBeenCalledWith({ width: 160, height: 80 })
  })

  it('releases every context and every rendered image, full render and preview alike', async () => {
    fixtures.nextRenderedResults = [{ base64: 'FULL' }, { base64: 'PREVIEW' }]
    await encodeNativeVideoFrame(thumbnail, 0.6)
    expect(fixtures.contexts).toHaveLength(2)
    expect(fixtures.rendered).toHaveLength(2)
    expect(fixtures.contexts.every((c) => c.release.mock.calls.length === 1)).toBe(true)
    expect(fixtures.rendered.every((r) => r.release.mock.calls.length === 1)).toBe(true)
  })

  it('releases the context and rendered image even when saveAsync throws', async () => {
    fixtures.nextRenderedResults = [new Error('disk full')]
    await expect(encodeNativeVideoFrame(thumbnail, 0.6)).rejects.toThrow('disk full')
    expect(fixtures.contexts).toHaveLength(1)
    expect(fixtures.rendered).toHaveLength(1)
    expect(fixtures.contexts[0]!.release).toHaveBeenCalledOnce()
    expect(fixtures.rendered[0]!.release).toHaveBeenCalledOnce()
  })

  it('fails loudly, releasing everything, when the native save hands back no base64 at all', async () => {
    fixtures.nextRenderedResults = [{}]
    await expect(encodeNativeVideoFrame(thumbnail, 0.6)).rejects.toBeInstanceOf(VideoFrameExtractionError)
    expect(fixtures.contexts[0]!.release).toHaveBeenCalledOnce()
    expect(fixtures.rendered[0]!.release).toHaveBeenCalledOnce()
    // The preview render is never reached once the full-quality one already failed.
    expect(manipulate).toHaveBeenCalledTimes(1)
  })

  it('fails loudly, releasing everything, when the PREVIEW save hands back no base64', async () => {
    fixtures.nextRenderedResults = [{ base64: 'FULL' }, {}]
    await expect(encodeNativeVideoFrame(thumbnail, 0.6)).rejects.toBeInstanceOf(VideoFrameExtractionError)
    expect(fixtures.contexts).toHaveLength(2)
    expect(fixtures.contexts.every((c) => c.release.mock.calls.length === 1)).toBe(true)
    expect(fixtures.rendered.every((r) => r.release.mock.calls.length === 1)).toBe(true)
  })
})
