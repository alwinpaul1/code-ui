import { describe, expect, it, vi } from 'vitest'
import {
  computeVideoFrameTimestampsMs,
  extractVideoFrames,
  formatVideoFrameDurationLabel,
  formatVideoFrameIntervalLabel,
  formatVideoFrameSizeLabel,
  VideoFrameExtractionCancelledError,
  VideoFrameExtractionError,
  VIDEO_FRAME_MAX_COUNT,
  type VideoFramePlayer,
  type VideoFrameThumbnail
} from './mobile-video-frame-extractor'

function fakeThumbnail(): VideoFrameThumbnail & { released: boolean } {
  const thumbnail = {
    released: false,
    release() {
      thumbnail.released = true
    }
  }
  return thumbnail
}

/** A headless player double: `durationSec` is what `waitUntilReady` unlocks,
 *  and `generateThumbnails` hands back one fresh thumbnail per requested time
 *  unless `thumbnailsPerCall` says otherwise. */
function fakePlayer(
  durationSec: number,
  options?: {
    readyError?: Error
    thumbnailsPerCall?: (timesSec: number[]) => VideoFrameThumbnail[]
  }
): VideoFramePlayer & { released: boolean; generateThumbnailsCalls: Array<{ times: number[]; maxEdge: number }> } {
  const generateThumbnailsCalls: Array<{ times: number[]; maxEdge: number }> = []
  const player = {
    duration: durationSec,
    released: false,
    generateThumbnailsCalls,
    waitUntilReady: async () => {
      if (options?.readyError) {
        throw options.readyError
      }
    },
    generateThumbnails: async (timesSec: number[], maxEdge: number) => {
      generateThumbnailsCalls.push({ times: timesSec, maxEdge })
      return options?.thumbnailsPerCall ? options.thumbnailsPerCall(timesSec) : timesSec.map(() => fakeThumbnail())
    },
    release: () => {
      player.released = true
    }
  }
  return player
}

describe('computeVideoFrameTimestampsMs', () => {
  it('takes one frame from a 1-second video', () => {
    expect(computeVideoFrameTimestampsMs(1000)).toEqual([0])
  })

  it('refuses a zero-length video rather than picking a frame that cannot exist', () => {
    expect(() => computeVideoFrameTimestampsMs(0)).toThrow(VideoFrameExtractionError)
    expect(() => computeVideoFrameTimestampsMs(0)).toThrow(/no readable duration/)
  })

  it('refuses a negative or non-finite duration the same way', () => {
    expect(() => computeVideoFrameTimestampsMs(-1)).toThrow(VideoFrameExtractionError)
    expect(() => computeVideoFrameTimestampsMs(Number.NaN)).toThrow(VideoFrameExtractionError)
  })

  it('takes one frame per second for a short video, first frame at 0', () => {
    const timestamps = computeVideoFrameTimestampsMs(15_000)
    expect(timestamps).toHaveLength(15)
    expect(timestamps[0]).toBe(0)
  })

  it('caps a video right at the crossover (20 s) at one frame per second', () => {
    expect(computeVideoFrameTimestampsMs(20_000)).toHaveLength(20)
  })

  it('caps a longer video at 20 evenly spaced frames, first and last included', () => {
    // 2 min 14 s, the worked example: 134 s / 20 = 6.7 s apart.
    const timestamps = computeVideoFrameTimestampsMs(134_000)
    expect(timestamps).toHaveLength(20)
    expect(timestamps[0]).toBe(0)
    expect(timestamps.at(-1)).toBe(134_000 - 1)
  })

  it('stays capped at about 20 frames for a very long video', () => {
    // Two hours.
    const timestamps = computeVideoFrameTimestampsMs(2 * 60 * 60 * 1000)
    expect(timestamps).toHaveLength(VIDEO_FRAME_MAX_COUNT)
    expect(new Set(timestamps).size).toBe(VIDEO_FRAME_MAX_COUNT)
  })
})

describe('the notes numbers', () => {
  it('formats a duration under a minute as seconds only', () => {
    expect(formatVideoFrameDurationLabel(1000)).toBe('1 s')
  })

  it('formats the worked example\'s duration as minutes and seconds', () => {
    expect(formatVideoFrameDurationLabel(134_000)).toBe('2 min 14 s')
  })

  it('formats the worked example\'s cadence with one decimal', () => {
    expect(formatVideoFrameIntervalLabel(6700)).toBe('every 6.7 s')
  })

  it('drops the decimal for a whole-number cadence', () => {
    expect(formatVideoFrameIntervalLabel(1000)).toBe('every 1 s')
  })

  it('formats a whole-megabyte size, matching the "18 MB max" wording', () => {
    expect(formatVideoFrameSizeLabel(142 * 1024 * 1024)).toBe('142 MB')
  })

  it('says "an unknown size" rather than inventing a figure', () => {
    expect(formatVideoFrameSizeLabel(null)).toBe('an unknown size')
  })
})

describe('extractVideoFrames', () => {
  it('reads the duration, then pulls and encodes each frame in turn, reporting progress as it goes', async () => {
    const player = fakePlayer(15) // 15 s -> 15 frames, one per second
    const encodeFrame = vi.fn(async (_thumbnail, quality: number) => ({ base64: `frame-${quality}` }))
    const progress: Array<{ done: number; total: number }> = []

    const result = await extractVideoFrames('file:///clip.mp4', {
      createPlayer: () => player,
      encodeFrame,
      onProgress: (p) => progress.push(p)
    })

    expect(result.frames).toHaveLength(15)
    expect(result.frames[0]).toEqual({ base64: 'frame-0.6', index: 1 })
    expect(result.durationMs).toBe(15_000)
    expect(result.intervalMs).toBe(1000)
    // One call per frame, not one batched call — so a per-frame chip can
    // reflect a frame as it lands, not the whole video at once.
    expect(player.generateThumbnailsCalls).toHaveLength(15)
    expect(progress[0]).toEqual({ done: 0, total: 15 })
    expect(progress.at(-1)).toEqual({ done: 15, total: 15 })
    expect(player.released).toBe(true)
  })

  it('releases every thumbnail once it has been encoded', async () => {
    const thumbnails: Array<VideoFrameThumbnail & { released: boolean }> = []
    const player = fakePlayer(2, {
      thumbnailsPerCall: () => {
        const thumbnail = fakeThumbnail()
        thumbnails.push(thumbnail)
        return [thumbnail]
      }
    })
    await extractVideoFrames('file:///clip.mp4', {
      createPlayer: () => player,
      encodeFrame: async () => ({ base64: 'x' })
    })
    expect(thumbnails).toHaveLength(2)
    expect(thumbnails.every((t) => t.released)).toBe(true)
  })

  it('passes the configured cap edge through to every frame request', async () => {
    const player = fakePlayer(3)
    await extractVideoFrames('file:///clip.mp4', {
      createPlayer: () => player,
      encodeFrame: async () => ({ base64: 'x' }),
      maxEdge: 999
    })
    expect(player.generateThumbnailsCalls.every((call) => call.maxEdge === 999)).toBe(true)
  })

  it('surfaces a codec/DRM failure as VideoFrameExtractionError, releasing the player', async () => {
    const player = fakePlayer(10, { readyError: new Error('Unsupported codec') })
    await expect(
      extractVideoFrames('file:///drm.mp4', { createPlayer: () => player, encodeFrame: async () => ({ base64: 'x' }) })
    ).rejects.toThrow('Unsupported codec')
    expect(player.released).toBe(true)
  })

  it('fails loudly when the native player hands back no frame for a time', async () => {
    const player = fakePlayer(5, { thumbnailsPerCall: () => [] })
    await expect(
      extractVideoFrames('file:///clip.mp4', { createPlayer: () => player, encodeFrame: async () => ({ base64: 'x' }) })
    ).rejects.toThrow(/could not read a frame/i)
    expect(player.released).toBe(true)
  })

  it('stops between frames when cancelled, taking none of the frames after the cut', async () => {
    const controller = new AbortController()
    const encodeFrame = vi.fn(async () => ({ base64: 'x' }))
    const player = fakePlayer(10, {
      thumbnailsPerCall: () => {
        // Cancel lands after the second frame has been pulled, before it is encoded.
        if (encodeFrame.mock.calls.length === 2) {
          controller.abort()
        }
        return [fakeThumbnail()]
      }
    })

    await expect(
      extractVideoFrames('file:///clip.mp4', {
        createPlayer: () => player,
        encodeFrame,
        signal: controller.signal
      })
    ).rejects.toBeInstanceOf(VideoFrameExtractionCancelledError)
    expect(encodeFrame.mock.calls.length).toBeLessThan(10)
    expect(player.released).toBe(true)
  })

  it('reads no duration and pulls no frame when already cancelled before the player is asked to get ready', async () => {
    const controller = new AbortController()
    controller.abort()
    const player = fakePlayer(10)
    const waitUntilReady = vi.spyOn(player, 'waitUntilReady')
    await expect(
      extractVideoFrames('file:///clip.mp4', {
        createPlayer: () => player,
        encodeFrame: async () => ({ base64: 'x' }),
        signal: controller.signal
      })
    ).rejects.toBeInstanceOf(VideoFrameExtractionCancelledError)
    expect(waitUntilReady).not.toHaveBeenCalled()
    expect(player.generateThumbnailsCalls).toHaveLength(0)
    expect(player.released).toBe(true)
  })
})
