import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  computeVideoFrameTimestampsMs,
  describeVideoFrameExtractionFailure,
  extractVideoFrames,
  formatVideoFrameDurationLabel,
  formatVideoFrameIntervalLabel,
  formatVideoFrameSizeLabel,
  videoFrameSampledIntervalMs,
  VideoFrameExtractionCancelledError,
  VideoFrameExtractionError,
  VIDEO_FRAME_MAX_COUNT,
  VIDEO_FRAME_READY_TIMEOUT_MS,
  type VideoFrameExtractionEvent,
  type VideoFramePlayer,
  type VideoFrameThumbnail
} from './mobile-video-frame-extractor'

function fakeThumbnail(width = 1280, height = 720): VideoFrameThumbnail & { released: boolean } {
  const thumbnail = {
    width,
    height,
    released: false,
    release() {
      thumbnail.released = true
    }
  }
  return thumbnail
}

/** A headless player double. `durationSec` is what `waitUntilReady` unlocks
 *  (immediately, unless `neverReady` holds it forever); `generateThumbnails`
 *  hands back one fresh thumbnail per requested time unless
 *  `thumbnailsPerCall` says otherwise. */
function fakePlayer(
  durationSec: number,
  options?: {
    readyError?: Error
    neverReady?: boolean
    thumbnailsPerCall?: (timesSec: number[]) => VideoFrameThumbnail[]
  }
): VideoFramePlayer & { released: boolean; generateThumbnailsCalls: Array<{ times: number[]; maxEdge: number }> } {
  const generateThumbnailsCalls: Array<{ times: number[]; maxEdge: number }> = []
  const player = {
    duration: durationSec,
    released: false,
    generateThumbnailsCalls,
    waitUntilReady: () =>
      options?.neverReady
        ? new Promise<void>(() => {})
        : options?.readyError
          ? Promise.reject(options.readyError)
          : Promise.resolve(),
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

/** Drains an `extractVideoFrames` generator into its meta event and the
 *  frame events, in order — the shape almost every test here wants. */
async function collect(
  events: AsyncGenerator<VideoFrameExtractionEvent>
): Promise<{ meta: Extract<VideoFrameExtractionEvent, { kind: 'meta' }> | null; frames: string[] }> {
  let meta: Extract<VideoFrameExtractionEvent, { kind: 'meta' }> | null = null
  const frames: string[] = []
  for await (const event of events) {
    if (event.kind === 'meta') {
      meta = event
    } else {
      frames.push(event.frame.base64)
    }
  }
  return { meta, frames }
}

const fakeEncoder = async (_thumbnail: VideoFrameThumbnail, quality: number) => ({
  base64: `frame-${quality}`,
  previewBase64: `preview-${quality}`
})

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
    const timestamps = computeVideoFrameTimestampsMs(134_000)
    expect(timestamps).toHaveLength(20)
    expect(timestamps[0]).toBe(0)
    expect(timestamps.at(-1)).toBe(134_000 - 1)
  })

  it('stays capped at about 20 frames for a very long video', () => {
    const timestamps = computeVideoFrameTimestampsMs(2 * 60 * 60 * 1000)
    expect(timestamps).toHaveLength(VIDEO_FRAME_MAX_COUNT)
    expect(new Set(timestamps).size).toBe(VIDEO_FRAME_MAX_COUNT)
  })
})

describe('videoFrameSampledIntervalMs', () => {
  it('is null for a single timestamp — there is no gap to report', () => {
    expect(videoFrameSampledIntervalMs([0])).toBeNull()
  })

  it('is the real average gap across the actual timestamps, not duration/count', () => {
    // 2026-09-27 review: the note used to claim durationMs/total (134000/20 =
    // 6700ms), which is not the gap between the frames actually placed —
    // those span 0..133999 across 19 gaps, (133999)/19 ≈ 7052.6ms.
    const timestamps = computeVideoFrameTimestampsMs(134_000)
    expect(videoFrameSampledIntervalMs(timestamps)).toBe(7053)
  })

  it('reflects a plain even split for a short, 1-fps-regime video', () => {
    const timestamps = computeVideoFrameTimestampsMs(3000) // count=3: 0, 1500, 2999
    expect(videoFrameSampledIntervalMs(timestamps)).toBe(Math.round(2999 / 2))
  })
})

describe('the note\'s numbers', () => {
  it('formats a duration under a minute as seconds only', () => {
    expect(formatVideoFrameDurationLabel(1000)).toBe('1 s')
  })

  it('formats a video under half a second as "under 1 s", not "0 s"', () => {
    // 2026-09-27 review: Math.round(300 / 1000) is 0, and a bare "0 s" reads
    // as "this video has no duration" rather than "this video is very short".
    expect(formatVideoFrameDurationLabel(300)).toBe('under 1 s')
  })

  it('formats the worked example\'s duration as minutes and seconds', () => {
    expect(formatVideoFrameDurationLabel(134_000)).toBe('2 min 14 s')
  })

  it('formats a real sampled cadence with one decimal', () => {
    expect(formatVideoFrameIntervalLabel(7053)).toBe('every 7.1 s')
  })

  it('drops the decimal for a whole-number cadence', () => {
    expect(formatVideoFrameIntervalLabel(1000)).toBe('every 1 s')
  })

  it('is null, not "every 0 s", for a single-frame group', () => {
    expect(formatVideoFrameIntervalLabel(null)).toBeNull()
  })

  it('formats a whole-megabyte size, matching the "18 MB max" wording', () => {
    expect(formatVideoFrameSizeLabel(142 * 1024 * 1024)).toBe('142 MB')
  })

  it('says "an unknown size" rather than inventing a figure', () => {
    expect(formatVideoFrameSizeLabel(null)).toBe('an unknown size')
  })
})

describe('describeVideoFrameExtractionFailure', () => {
  it('maps this module\'s own messages to a short reason, never the raw text verbatim', () => {
    expect(describeVideoFrameExtractionFailure(new Error('Timed out waiting for the video to load'))).toBe(
      'took too long to load'
    )
    expect(describeVideoFrameExtractionFailure(new VideoFrameExtractionError('This video has no readable duration'))).toBe(
      'has no readable length'
    )
    expect(describeVideoFrameExtractionFailure(new VideoFrameExtractionError('Could not read a frame from this video'))).toBe(
      'could not be read at one of its frames'
    )
  })

  it('never repeats a raw native exception string verbatim', () => {
    const raw = 'MediaCodec.CodecException: Error 0xfffffc0e occurred'
    expect(describeVideoFrameExtractionFailure(new Error(raw))).not.toContain('MediaCodec')
    expect(describeVideoFrameExtractionFailure(new Error(raw))).toBe('could not be read')
  })

  it('does not double the dash when a native error carries no message of its own', () => {
    // 2026-09-27 review: mobile-video-frame-player.ts's own fallback
    // ('This video could not be read') lands in the 'could not be read'
    // branch, and every caller already writes its own dash before this
    // reason ("... (18 MB max) — the video ${reason}"). A reason with an
    // embedded dash of its own reads as two dashes in one sentence.
    const reason = describeVideoFrameExtractionFailure(new VideoFrameExtractionError('This video could not be read'))
    const toast = `File too large to attach (18 MB max) — the video ${reason}`
    expect(toast.match(/—/g)).toHaveLength(1)
    expect(toast).toBe('File too large to attach (18 MB max) — the video could not be read; the format may not be supported')
  })
})

describe('extractVideoFrames', () => {
  it('yields meta first, then pulls and encodes each frame in turn, reporting progress as it goes', async () => {
    const player = fakePlayer(15) // 15 s -> 15 frames, one per second
    const progress: Array<{ done: number; total: number }> = []

    const { meta, frames } = await collect(
      extractVideoFrames('file:///clip.mp4', {
        createPlayer: () => player,
        encodeFrame: fakeEncoder,
        onProgress: (p) => progress.push(p)
      })
    )

    expect(meta).toMatchObject({ kind: 'meta', total: 15, durationMs: 15_000 })
    expect(frames).toHaveLength(15)
    // One call per frame, not one batched call — so a per-frame chip can
    // reflect a frame as it lands, not the whole video at once.
    expect(player.generateThumbnailsCalls).toHaveLength(15)
    expect(progress[0]).toEqual({ done: 0, total: 15 })
    expect(progress.at(-1)).toEqual({ done: 15, total: 15 })
    expect(player.released).toBe(true)
  })

  it('never pulls the next frame until the caller has taken the previous one', async () => {
    const pulledAt: number[] = []
    const player = fakePlayer(3, {
      thumbnailsPerCall: (times) => {
        pulledAt.push(times[0] as number)
        return [fakeThumbnail()]
      }
    })
    const events = extractVideoFrames('file:///clip.mp4', { createPlayer: () => player, encodeFrame: fakeEncoder })
    await events.next() // meta
    expect(pulledAt).toHaveLength(0)
    await events.next() // frame 1
    expect(pulledAt).toHaveLength(1)
    await events.next() // frame 2
    expect(pulledAt).toHaveLength(2)
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
    await collect(extractVideoFrames('file:///clip.mp4', { createPlayer: () => player, encodeFrame: fakeEncoder }))
    expect(thumbnails).toHaveLength(2)
    expect(thumbnails.every((t) => t.released)).toBe(true)
  })

  it('passes the configured cap edge through to every frame request', async () => {
    const player = fakePlayer(3)
    await collect(
      extractVideoFrames('file:///clip.mp4', { createPlayer: () => player, encodeFrame: fakeEncoder, maxEdge: 999 })
    )
    expect(player.generateThumbnailsCalls.every((call) => call.maxEdge === 999)).toBe(true)
  })

  it('surfaces a codec/DRM failure as VideoFrameExtractionError, releasing the player', async () => {
    const player = fakePlayer(10, { readyError: new Error('Unsupported codec') })
    await expect(
      collect(extractVideoFrames('file:///drm.mp4', { createPlayer: () => player, encodeFrame: fakeEncoder }))
    ).rejects.toThrow('Unsupported codec')
    expect(player.released).toBe(true)
  })

  it('fails loudly when the native player hands back no frame for a time', async () => {
    const player = fakePlayer(5, { thumbnailsPerCall: () => [] })
    await expect(
      collect(extractVideoFrames('file:///clip.mp4', { createPlayer: () => player, encodeFrame: fakeEncoder }))
    ).rejects.toThrow(/could not read a frame/i)
    expect(player.released).toBe(true)
  })

  it('releases a thumbnail even when cancellation lands right after it is pulled', async () => {
    // 2026-09-27 review: the cancel check used to sit between `generateThumbnails`
    // resolving and the try/finally that releases the thumbnail, so a cancel
    // seen in that exact window threw past the release entirely.
    const controller = new AbortController()
    const thumbnails: Array<VideoFrameThumbnail & { released: boolean }> = []
    const player = fakePlayer(5, {
      thumbnailsPerCall: () => {
        const thumbnail = fakeThumbnail()
        thumbnails.push(thumbnail)
        controller.abort()
        return [thumbnail]
      }
    })
    await expect(
      collect(
        extractVideoFrames('file:///clip.mp4', {
          createPlayer: () => player,
          encodeFrame: fakeEncoder,
          signal: controller.signal
        })
      )
    ).rejects.toBeInstanceOf(VideoFrameExtractionCancelledError)
    expect(thumbnails).toHaveLength(1)
    expect(thumbnails[0]!.released).toBe(true)
  })

  it('stops between frames when cancelled, taking none of the frames after the cut', async () => {
    const controller = new AbortController()
    let pulled = 0
    const player = fakePlayer(10, {
      thumbnailsPerCall: () => {
        pulled += 1
        if (pulled === 2) {
          controller.abort()
        }
        return [fakeThumbnail()]
      }
    })

    await expect(
      collect(
        extractVideoFrames('file:///clip.mp4', {
          createPlayer: () => player,
          encodeFrame: fakeEncoder,
          signal: controller.signal
        })
      )
    ).rejects.toBeInstanceOf(VideoFrameExtractionCancelledError)
    expect(pulled).toBeLessThan(10)
    expect(player.released).toBe(true)
  })

  it('reads no duration and pulls no frame when already cancelled before the player is asked to get ready', async () => {
    const controller = new AbortController()
    controller.abort()
    const player = fakePlayer(10)
    const waitUntilReady = vi.spyOn(player, 'waitUntilReady')
    await expect(
      collect(
        extractVideoFrames('file:///clip.mp4', {
          createPlayer: () => player,
          encodeFrame: fakeEncoder,
          signal: controller.signal
        })
      )
    ).rejects.toBeInstanceOf(VideoFrameExtractionCancelledError)
    expect(waitUntilReady).not.toHaveBeenCalled()
    expect(player.generateThumbnailsCalls).toHaveLength(0)
    expect(player.released).toBe(true)
  })
})

describe('extractVideoFrames — readiness timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fails rather than leaking the player forever when readyToPlay never arrives', async () => {
    const player = fakePlayer(10, { neverReady: true })
    const events = extractVideoFrames('file:///clip.mp4', {
      createPlayer: () => player,
      encodeFrame: fakeEncoder,
      readyTimeoutMs: 5000
    })
    const pending = collect(events).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(5000)
    const result = await pending
    expect(result).toBeInstanceOf(VideoFrameExtractionError)
    expect((result as Error).message).toMatch(/timed out/i)
    expect(player.released).toBe(true)
  })

  it('defaults the timeout to 10 seconds', async () => {
    const player = fakePlayer(10, { neverReady: true })
    const pending = collect(
      extractVideoFrames('file:///clip.mp4', { createPlayer: () => player, encodeFrame: fakeEncoder })
    ).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(VIDEO_FRAME_READY_TIMEOUT_MS - 1)
    expect(player.released).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const result = await pending
    expect(result).toBeInstanceOf(VideoFrameExtractionError)
  })

  it('cancels the wait for readiness too, not just the per-frame loop', async () => {
    const controller = new AbortController()
    const player = fakePlayer(10, { neverReady: true })
    const pending = collect(
      extractVideoFrames('file:///clip.mp4', {
        createPlayer: () => player,
        encodeFrame: fakeEncoder,
        signal: controller.signal,
        readyTimeoutMs: 30_000
      })
    ).catch((error: unknown) => error)
    controller.abort()
    const result = await pending
    expect(result).toBeInstanceOf(VideoFrameExtractionCancelledError)
    expect(player.released).toBe(true)
  })
})
