/**
 * Turning an over-the-cap video into a handful of still frames, entirely on
 * the phone: the desktop refuses a phone upload over 18 MiB
 * (`CLIPBOARD_IMAGE_MAX_SOURCE_BYTES`) and Claude Code cannot watch video
 * anyway, so a video the user attaches over that line is read for its frames
 * instead of refused outright.
 *
 * Every native call (reading the video's duration, decoding a frame, encoding
 * it to JPEG) is behind the `VideoFramePlayer`/`VideoFrameEncoder` seams so
 * this module never imports `expo-video` or `expo-image-manipulator` itself —
 * the production wiring lives in `mobile-video-frame-player.ts`, and a test
 * supplies a fake player instead of a real video file.
 */

/** The frame count never goes past this many, however long the video is. */
export const VIDEO_FRAME_MAX_COUNT = 20
/** Longest edge a frame is decoded and encoded at. */
export const VIDEO_FRAME_MAX_EDGE = 1280
/** JPEG quality for a frame — comfortably under 1 MB at `VIDEO_FRAME_MAX_EDGE`. */
export const VIDEO_FRAME_JPEG_QUALITY = 0.6

export class VideoFrameExtractionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VideoFrameExtractionError'
  }
}

export class VideoFrameExtractionCancelledError extends Error {
  constructor() {
    super('Video frame extraction cancelled')
    this.name = 'VideoFrameExtractionCancelledError'
  }
}

/** An opaque native image reference (a `SharedRef<'image'>` from `expo-video`,
 *  in production) — this module never looks inside one, only passes it to
 *  `VideoFrameEncoder` and releases it afterwards. */
export type VideoFrameThumbnail = {
  release(): void
}

/** A headless video, wrapping just enough of `expo-video`'s player for frame
 *  extraction: no `<VideoView>`, nothing rendered. */
export type VideoFramePlayer = {
  /** Valid only once `waitUntilReady` has resolved. Seconds. */
  readonly duration: number
  /** Resolves once the player has read the source's metadata (duration,
   *  tracks), or rejects with a `VideoFrameExtractionError` describing why —
   *  a codec the phone cannot decode, a DRM file, or anything else the
   *  native player reports as its error status. */
  waitUntilReady(): Promise<void>
  /** One frame at `timeSec`, its longest edge capped at `maxEdge` (aspect
   *  preserved). Empty/short result reads as "could not read a frame". */
  generateThumbnails(timesSec: number[], maxEdge: number): Promise<VideoFrameThumbnail[]>
  release(): void
}

export type VideoFrameEncoder = (
  thumbnail: VideoFrameThumbnail,
  quality: number
) => Promise<{ base64: string }>

export type VideoFrameExtractionProgress = {
  readonly done: number
  readonly total: number
}

export type VideoFrameExtractionDeps = {
  readonly createPlayer: (uri: string) => VideoFramePlayer
  readonly encodeFrame: VideoFrameEncoder
  readonly onProgress?: (progress: VideoFrameExtractionProgress) => void
  readonly signal?: AbortSignal
  readonly maxFrames?: number
  readonly maxEdge?: number
  readonly quality?: number
}

export type ExtractedVideoFrame = {
  readonly base64: string
  /** 1-based. */
  readonly index: number
}

export type VideoFrameExtractionResult = {
  readonly frames: readonly ExtractedVideoFrame[]
  readonly durationMs: number
  /** The nominal cadence used in the note ("every 6.7 s"): `durationMs / total`,
   *  not the literal gap between the last two samples. */
  readonly intervalMs: number
}

/**
 * The timestamps (ms, ascending, first is 0) to pull frames at.
 *
 * One frame per second for a video short enough that this stays at or under
 * the cap; otherwise `maxFrames` frames evenly spaced from the first instant
 * to the last, so the video's start and end are never missed regardless of
 * length. Throws when the duration is not a usable positive number — a
 * zero-length (or unreadable) video has no frame to take.
 */
export function computeVideoFrameTimestampsMs(
  durationMs: number,
  maxFrames: number = VIDEO_FRAME_MAX_COUNT
): number[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new VideoFrameExtractionError('This video has no readable duration')
  }
  const perSecondCount = Math.max(1, Math.round(durationMs / 1000))
  const count = Math.min(maxFrames, perSecondCount)
  if (count <= 1) {
    return [0]
  }
  const timestamps: number[] = []
  for (let i = 0; i < count; i += 1) {
    timestamps.push(Math.round((i * (durationMs - 1)) / (count - 1)))
  }
  return timestamps
}

/** "2 min 14 s", or "14 s" under a minute. */
export function formatVideoFrameDurationLabel(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes} min ${seconds} s` : `${seconds} s`
}

/** "every 6.7 s" — one decimal place, dropped when it is a whole number. */
export function formatVideoFrameIntervalLabel(intervalMs: number): string {
  const seconds = Math.round((intervalMs / 1000) * 10) / 10
  const rounded = Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1)
  return `every ${rounded} s`
}

/** "142 MB" — whole megabytes, matching the existing "18 MB max" wording.
 *  `null` reads as "an unknown size": the source's byte size could not be
 *  proven without reading it, which this feature never does. */
export function formatVideoFrameSizeLabel(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) {
    return 'an unknown size'
  }
  return `${Math.round(bytes / (1024 * 1024))} MB`
}

function checkCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new VideoFrameExtractionCancelledError()
  }
}

/**
 * Reads `uri`'s duration, picks frame timestamps, and pulls + encodes each
 * one in turn — never all at once, so `onProgress` (and a cancel through
 * `signal`) lands between frames rather than after the whole video.
 */
export async function extractVideoFrames(
  uri: string,
  deps: VideoFrameExtractionDeps
): Promise<VideoFrameExtractionResult> {
  const maxFrames = deps.maxFrames ?? VIDEO_FRAME_MAX_COUNT
  const maxEdge = deps.maxEdge ?? VIDEO_FRAME_MAX_EDGE
  const quality = deps.quality ?? VIDEO_FRAME_JPEG_QUALITY
  const player = deps.createPlayer(uri)
  try {
    checkCancelled(deps.signal)
    await player.waitUntilReady()
    checkCancelled(deps.signal)
    const durationMs = Math.round(player.duration * 1000)
    const timestampsMs = computeVideoFrameTimestampsMs(durationMs, maxFrames)
    const total = timestampsMs.length
    const frames: ExtractedVideoFrame[] = []
    deps.onProgress?.({ done: 0, total })
    for (let i = 0; i < timestampsMs.length; i += 1) {
      checkCancelled(deps.signal)
      const timeSec = (timestampsMs[i] as number) / 1000
      const thumbnails = await player.generateThumbnails([timeSec], maxEdge)
      checkCancelled(deps.signal)
      const thumbnail = thumbnails[0]
      if (!thumbnail) {
        throw new VideoFrameExtractionError('Could not read a frame from this video')
      }
      try {
        const encoded = await deps.encodeFrame(thumbnail, quality)
        frames.push({ base64: encoded.base64, index: i + 1 })
      } finally {
        thumbnail.release()
      }
      deps.onProgress?.({ done: i + 1, total })
    }
    return { frames, durationMs, intervalMs: Math.round(durationMs / total) }
  } finally {
    player.release()
  }
}
