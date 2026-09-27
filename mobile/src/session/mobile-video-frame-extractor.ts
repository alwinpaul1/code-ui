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
/** Longest edge a frame is decoded and encoded at, for the upload itself. */
export const VIDEO_FRAME_MAX_EDGE = 1280
/** JPEG quality for a frame — comfortably under 1 MB at `VIDEO_FRAME_MAX_EDGE`. */
export const VIDEO_FRAME_JPEG_QUALITY = 0.6
/** Longest edge of the SEPARATE small copy kept as the chip's preview — a
 *  60×60 chip never needed the full upload-quality frame, and holding all 20
 *  of those (up to ~1 MB of base64 each) in the attachment store for the
 *  whole time the user is composing was the actual memory cost
 *  (2026-09-27 review). Raised from 160 to 640 in the very next review: this
 *  copy is also the ONLY picture a video-frame chip has — its markup pencil
 *  is hidden (`MobileNativeChatAttachmentChips.tsx`), so this is what a tap
 *  opens full-screen too, and 160px read as legibly blurry blown up that far. */
export const VIDEO_FRAME_PREVIEW_MAX_EDGE = 640
export const VIDEO_FRAME_PREVIEW_QUALITY = 0.5
/** `waitUntilReady` past this long fails loudly instead of leaking the player
 *  forever — nothing native ever promised the `readyToPlay` status arrives. */
export const VIDEO_FRAME_READY_TIMEOUT_MS = 10_000
/** Same reasoning, per frame: a stalled `generateThumbnails`/`encodeFrame`
 *  call carries no promise it ever settles either. Before this, cancel
 *  checked `signal` only between whole native calls, so a stall inside one
 *  left it unreachable — the extraction slot (and every send in that tab
 *  waiting on it) stuck until the app restarted (2026-09-27 review). */
export const VIDEO_FRAME_STEP_TIMEOUT_MS = 10_000

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

/** A native image reference (a `SharedRef<'image'>` from `expo-video`, in
 *  production) — this module never decodes it itself, only reads its
 *  dimensions (to size the chip preview) and passes it to `VideoFrameEncoder`
 *  before releasing it. */
export type VideoFrameThumbnail = {
  readonly width: number
  readonly height: number
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
   *  native player reports as its error status. Never guaranteed to settle
   *  on its own; callers race it against a timeout. */
  waitUntilReady(): Promise<void>
  /** One frame at `timeSec`, its longest edge capped at `maxEdge` (aspect
   *  preserved). Empty/short result reads as "could not read a frame". */
  generateThumbnails(timesSec: number[], maxEdge: number): Promise<VideoFrameThumbnail[]>
  release(): void
}

export type EncodedVideoFrame = {
  readonly base64: string
  /** A separate, much smaller copy of the same frame, for the chip strip. */
  readonly previewBase64: string
}

export type VideoFrameEncoder = (
  thumbnail: VideoFrameThumbnail,
  quality: number
) => Promise<EncodedVideoFrame>

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
  readonly readyTimeoutMs?: number
  /** Per-frame counterpart of `readyTimeoutMs` — how long a single
   *  `generateThumbnails`/`encodeFrame` call is given before it is treated
   *  as stalled. Defaults to `VIDEO_FRAME_STEP_TIMEOUT_MS`. */
  readonly stepTimeoutMs?: number
}

export type ExtractedVideoFrame = EncodedVideoFrame & {
  /** 1-based. */
  readonly index: number
}

export type VideoFrameExtractionMeta = {
  readonly total: number
  readonly durationMs: number
  /** The average gap between consecutive sampled instants — `null` for a
   *  single-frame group, which has no gap to report. Computed from the real
   *  timestamps, not a nominal duration/count guess, so the note never
   *  states a cadence the frames were not actually pulled at. */
  readonly intervalMs: number | null
}

/** The first thing `extractVideoFrames` yields, once the duration is known
 *  and frame timestamps are chosen, before any frame is pulled — so a caller
 *  building per-frame metadata has it for every frame, including the first. */
export type VideoFrameExtractionEvent =
  | ({ readonly kind: 'meta' } & VideoFrameExtractionMeta)
  | { readonly kind: 'frame'; readonly frame: ExtractedVideoFrame }

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

/** The average gap between the timestamps `computeVideoFrameTimestampsMs`
 *  actually chose — `(last - first) / (count - 1)`, i.e. real gaps, not the
 *  count itself; a single timestamp has no gap and reads as `null`. */
export function videoFrameSampledIntervalMs(timestampsMs: readonly number[]): number | null {
  if (timestampsMs.length <= 1) {
    return null
  }
  const first = timestampsMs[0] as number
  const last = timestampsMs[timestampsMs.length - 1] as number
  return Math.round((last - first) / (timestampsMs.length - 1))
}

/** "2 min 14 s", or "14 s" under a minute — "under 1 s" rather than "0 s" for
 *  a video short enough to round down to nothing. */
export function formatVideoFrameDurationLabel(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  if (durationMs > 0 && totalSeconds === 0) {
    return 'under 1 s'
  }
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes} min ${seconds} s` : `${seconds} s`
}

/** "every 6.7 s" — one decimal place, dropped when it is a whole number.
 *  `null` (a single-frame group has no cadence) reads as `null`, not a
 *  fabricated "every 0 s". */
export function formatVideoFrameIntervalLabel(intervalMs: number | null): string | null {
  if (intervalMs === null) {
    return null
  }
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

/** A short, human reason out of whatever `VideoFrameExtractionError` carries
 *  — including a raw native exception string this module never wrote itself
 *  (Kotlin/Swift text has no place in a toast). Recognizes this module's own
 *  messages exactly; anything else is "could not read this video". */
export function describeVideoFrameExtractionFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()
  if (lower.includes('timed out') && lower.includes('frame')) {
    // A stalled per-frame native call (generateThumbnails/encodeFrame), not
    // the initial ready-wait — distinct enough from "took too long to load"
    // that a reader mid-read isn't told the video never opened at all.
    return 'took too long reading one of its frames'
  }
  if (lower.includes('timed out')) {
    return 'took too long to load'
  }
  if (lower.includes('no readable duration')) {
    return 'has no readable length'
  }
  if (lower.includes('could not read a frame')) {
    return 'could not be read at one of its frames'
  }
  if (lower.includes('could not encode')) {
    return 'could not be processed into images'
  }
  if (lower.includes('could not be read')) {
    // No embedded dash: this is the branch a native error with no message of
    // its own falls into (mobile-video-frame-player.ts's own fallback text is
    // what "could not be read" matches here), and the caller already puts one
    // dash of its own before this reason — a second one read as a mistake,
    // not emphasis (2026-09-27 review).
    return 'could not be read; the format may not be supported'
  }
  return 'could not be read'
}

function checkCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new VideoFrameExtractionCancelledError()
  }
}

/** For a raw native promise's rejection branch when nothing about the
 *  rejection itself is interesting — the race it was also given already
 *  turned it into the real, reported error; this is only here so a promise
 *  no one else awaits never surfaces an unhandled-rejection warning. */
function noop(): void {}

/** Resolves or rejects exactly as `promise` does, unless `signal` aborts or
 *  `timeoutMs` passes first — either one settles this race instead, and
 *  whichever loses is ignored (a `promise` that keeps running after losing
 *  the race, native code included, has nothing left listening to it). Shared
 *  by the ready-wait and the per-frame native calls: neither has a contract
 *  that it ever settles by itself, and a signal that only got checked
 *  BETWEEN calls could never interrupt one already in flight. */
function raceAgainstSignalAndTimeout<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  onTimeout: () => Error
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (run: () => void): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      run()
    }
    const timer = setTimeout(() => {
      finish(() => reject(onTimeout()))
    }, timeoutMs)
    const onAbort = (): void => {
      finish(() => reject(new VideoFrameExtractionCancelledError()))
    }
    signal?.addEventListener('abort', onAbort)
    promise.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error))
    )
  })
}

/** Resolves once `player` reports `readyToPlay`, rejects on its own `error`
 *  status, on `signal` aborting, or after `timeoutMs` with no answer at all. */
function waitUntilReadyOrTimeout(
  player: VideoFramePlayer,
  signal: AbortSignal | undefined,
  timeoutMs: number
): Promise<void> {
  return raceAgainstSignalAndTimeout(
    player.waitUntilReady(),
    signal,
    timeoutMs,
    () => new VideoFrameExtractionError('Timed out waiting for the video to load')
  )
}

/**
 * Reads `uri`'s duration, picks frame timestamps, and pulls + encodes each
 * one in turn, yielding it immediately — never holding more than one frame's
 * bytes at a time, and never extracting the next frame until the caller has
 * taken (and can start uploading) the one just yielded. A cancel through
 * `signal` is checked before each frame and stops the loop there; nothing
 * after the cut is ever pulled.
 */
export async function* extractVideoFrames(
  uri: string,
  deps: VideoFrameExtractionDeps
): AsyncGenerator<VideoFrameExtractionEvent, void, void> {
  const maxFrames = deps.maxFrames ?? VIDEO_FRAME_MAX_COUNT
  const maxEdge = deps.maxEdge ?? VIDEO_FRAME_MAX_EDGE
  const quality = deps.quality ?? VIDEO_FRAME_JPEG_QUALITY
  const readyTimeoutMs = deps.readyTimeoutMs ?? VIDEO_FRAME_READY_TIMEOUT_MS
  const stepTimeoutMs = deps.stepTimeoutMs ?? VIDEO_FRAME_STEP_TIMEOUT_MS
  const player = deps.createPlayer(uri)
  try {
    checkCancelled(deps.signal)
    await waitUntilReadyOrTimeout(player, deps.signal, readyTimeoutMs)
    checkCancelled(deps.signal)
    const durationMs = Math.round(player.duration * 1000)
    const timestampsMs = computeVideoFrameTimestampsMs(durationMs, maxFrames)
    const total = timestampsMs.length
    const intervalMs = videoFrameSampledIntervalMs(timestampsMs)
    deps.onProgress?.({ done: 0, total })
    yield { kind: 'meta', total, durationMs, intervalMs }
    for (let i = 0; i < timestampsMs.length; i += 1) {
      checkCancelled(deps.signal)
      const timeSec = (timestampsMs[i] as number) / 1000
      // The raw call, raced separately below: if it loses the race (a
      // timeout or a cancel), the real native call may still be running and
      // its thumbnails may still arrive later — `lostGenerateThumbnails`
      // tells this handler whether that late arrival needs releasing (never,
      // on the winning path: the array below is what the rest of this loop
      // iteration actually uses) (2026-09-27 review).
      let lostGenerateThumbnails = false
      const rawGenerateThumbnails = player.generateThumbnails([timeSec], maxEdge)
      rawGenerateThumbnails.then((lateThumbnails) => {
        if (lostGenerateThumbnails) {
          for (const late of lateThumbnails) {
            late.release()
          }
        }
      }, noop)
      let thumbnails: VideoFrameThumbnail[]
      try {
        thumbnails = await raceAgainstSignalAndTimeout(
          rawGenerateThumbnails,
          deps.signal,
          stepTimeoutMs,
          () => new VideoFrameExtractionError('Timed out reading a frame from this video')
        )
      } catch (error) {
        lostGenerateThumbnails = true
        throw error
      }
      const thumbnail = thumbnails[0]
      if (!thumbnail) {
        throw new VideoFrameExtractionError('Could not read a frame from this video')
      }
      try {
        // A cancel seen right here still releases the thumbnail, instead of
        // throwing past it unreleased.
        checkCancelled(deps.signal)
      } catch (error) {
        thumbnail.release()
        throw error
      }
      // The raw encode, released on ITS OWN settlement — not on the race's,
      // which can resolve (timeout or cancel) while this real call is still
      // reading `thumbnail`. Releasing on the race's schedule instead could
      // free the native image while `encodeFrame` still holds it
      // (2026-09-27 review).
      const rawEncode = deps.encodeFrame(thumbnail, quality)
      rawEncode.then(() => thumbnail.release(), () => thumbnail.release())
      const encoded = await raceAgainstSignalAndTimeout(
        rawEncode,
        deps.signal,
        stepTimeoutMs,
        () => new VideoFrameExtractionError('Timed out encoding a frame from this video')
      )
      deps.onProgress?.({ done: i + 1, total })
      yield { kind: 'frame', frame: { ...encoded, index: i + 1 } }
    }
  } finally {
    player.release()
  }
}
