import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeVideoChipPoster, peekVideoChipPosterForTests, requestVideoChipPoster, resetVideoChipPostersForTests, type VideoChipPosterDeps } from './mobile-video-chip-poster'
import { VIDEO_FRAME_PREVIEW_MAX_EDGE, VIDEO_FRAME_PREVIEW_QUALITY, type VideoFramePlayer, type VideoFrameThumbnail } from './mobile-video-frame-extractor'

// The frame a video chip in the composer is drawn over (2026-10-17: a screen recording loaded in the
// card's corner, where the Claude app draws the video's frame with the ring centred). Every native
// call is behind the extractor's own seams, so these drive the real failure shapes: a thumbnail call
// that throws, a player that never gets ready, a frame that encodes to nothing.

function fakeFrame(): VideoFrameThumbnail & { release: ReturnType<typeof vi.fn<() => void>> } {
  return { width: 1080, height: 2340, release: vi.fn<() => void>() }
}

function fakePlayer(overrides: Partial<VideoFramePlayer> = {}): VideoFramePlayer & { release: ReturnType<typeof vi.fn> } {
  const release = vi.fn()
  return {
    duration: 12,
    waitUntilReady: async () => {},
    generateThumbnails: async () => [fakeFrame()],
    ...overrides,
    release
  }
}

function deps(player: VideoFramePlayer, encode?: VideoChipPosterDeps['encodeFrame']): VideoChipPosterDeps {
  return {
    createPlayer: () => player,
    encodeFrame: encode ?? (async () => ({ base64: 'FULL', previewBase64: 'SMALL' })),
    readyTimeoutMs: 50,
    stepTimeoutMs: 50
  }
}

afterEach(() => {
  resetVideoChipPostersForTests()
  vi.restoreAllMocks()
})

describe('the frame a video chip is drawn over', () => {
  it('is the first frame, at the chip preview size, as a JPEG data URI, with the player and frame released', async () => {
    const frame = fakeFrame()
    const generateThumbnails = vi.fn(async () => [frame])
    const player = fakePlayer({ generateThumbnails })
    const encode = vi.fn(async () => ({ base64: 'FULL', previewBase64: 'SMALL' }))
    await expect(makeVideoChipPoster('file:///rec.mp4', deps(player, encode))).resolves.toBe('data:image/jpeg;base64,SMALL')
    expect(generateThumbnails).toHaveBeenCalledExactlyOnceWith([0], VIDEO_FRAME_PREVIEW_MAX_EDGE)
    expect(encode).toHaveBeenCalledExactlyOnceWith(frame, VIDEO_FRAME_PREVIEW_QUALITY)
    expect(frame.release).toHaveBeenCalledOnce()
    expect(player.release).toHaveBeenCalledOnce()
  })

  it('fails with the reason and still releases the player when the thumbnail call throws', async () => {
    const player = fakePlayer({
      generateThumbnails: async () => {
        throw new Error('generateThumbnailsAsync: unsupported codec')
      }
    })
    await expect(makeVideoChipPoster('file:///rec.mp4', deps(player))).rejects.toThrow('unsupported codec')
    expect(player.release).toHaveBeenCalledOnce()
  })

  it('gives up on a player that never gets ready instead of waiting forever', async () => {
    const player = fakePlayer({ waitUntilReady: () => new Promise<void>(() => {}) })
    await expect(makeVideoChipPoster('file:///rec.mp4', deps(player))).rejects.toThrow('Opening the video took longer than 50 ms')
    expect(player.release).toHaveBeenCalledOnce()
  })

  it('fails when the video gives no frame, or the frame encodes to nothing, releasing the frame', async () => {
    await expect(makeVideoChipPoster('file:///rec.mp4', deps(fakePlayer({ generateThumbnails: async () => [] })))).rejects.toThrow('no frame')
    const frame = fakeFrame()
    const player = fakePlayer({ generateThumbnails: async () => [frame] })
    await expect(makeVideoChipPoster('file:///rec.mp4', deps(player, async () => ({ base64: '', previewBase64: '' })))).rejects.toThrow('encoded to nothing')
    expect(frame.release).toHaveBeenCalledOnce()
    expect(player.release).toHaveBeenCalledOnce()
  })
})

describe('asking for a video chip frame', () => {
  it('makes it once per video, and a failure warns once and is not retried', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const maker = vi.fn(async () => {
      throw new Error('This video could not be read')
    })
    resetVideoChipPostersForTests(maker)
    requestVideoChipPoster('file:///rec.mp4')
    requestVideoChipPoster('file:///rec.mp4')
    await vi.waitFor(() => expect(peekVideoChipPosterForTests('file:///rec.mp4')).toEqual({ status: 'failed' }))
    requestVideoChipPoster('file:///rec.mp4')
    expect(maker).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0]?.[0])).toContain('This video could not be read')
  })

  it('asks for nothing for an empty URI', () => {
    const maker = vi.fn(async () => 'data:image/jpeg;base64,X')
    resetVideoChipPostersForTests(maker)
    requestVideoChipPoster('')
    expect(maker).not.toHaveBeenCalled()
  })
})
