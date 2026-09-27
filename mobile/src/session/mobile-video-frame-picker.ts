import { CLIPBOARD_IMAGE_MAX_SOURCE_BYTES } from '../../../src/shared/clipboard-image'
import type { PickedMobileImage, VideoFrameAttachmentMeta } from '../platform/media-picker-contract'
import {
  extractVideoFrames,
  formatVideoFrameDurationLabel,
  formatVideoFrameIntervalLabel,
  formatVideoFrameSizeLabel,
  VideoFrameExtractionCancelledError,
  VideoFrameExtractionError,
  type VideoFrameExtractionEvent,
  type VideoFrameExtractionMeta,
  type VideoFrameExtractionProgress
} from './mobile-video-frame-extractor'
import type { MobileImageFileFactory } from './mobile-image-source-picker'

export { VideoFrameExtractionCancelledError, VideoFrameExtractionError }

const VIDEO_EXTENSION_RE = /\.(mp4|mov|m4v|3gp|3g2|webm|mkv|avi|wmv)$/i

/** A document-picker asset is a video by its declared MIME type, or (some
 *  content providers omit one) by its file extension. */
export function isVideoAsset(asset: { mimeType?: string | null; name?: string | null; uri: string }): boolean {
  if (asset.mimeType && asset.mimeType.toLowerCase().startsWith('video/')) {
    return true
  }
  return VIDEO_EXTENSION_RE.test(asset.name ?? asset.uri)
}

/** The asset's byte size without reading its content — the document picker's
 *  own declared size, or a file stat as a fallback. Never a content read. */
export function videoAssetSizeBytes(
  asset: { size?: number | null; uri: string },
  createFile: MobileImageFileFactory
): number | null {
  if (typeof asset.size === 'number' && Number.isFinite(asset.size)) {
    return asset.size
  }
  try {
    const size = createFile(asset.uri).size
    return typeof size === 'number' && Number.isFinite(size) ? size : null
  } catch {
    return null
  }
}

/**
 * Over the desktop's phone-upload cap, and PROVABLY so.
 *
 * An unknown size does NOT route here (2026-09-27 review: it used to, on the
 * theory that reading an unproven-small video's whole bytes was the greater
 * risk). It routes to the ordinary whole-file path instead, which already
 * refuses a video that turns out to be too large — via its own bounded,
 * chunked size check (`readUriAsBase64`), never by loading the whole file —
 * so an unknown-size video keeps today's behavior exactly, large or small.
 */
export function isVideoOverUploadCap(sizeBytes: number | null): boolean {
  return sizeBytes !== null && sizeBytes > CLIPBOARD_IMAGE_MAX_SOURCE_BYTES
}

let videoFrameGroupCounter = 0

export type PickVideoFramesRuntimeOptions = {
  readonly onProgress?: (progress: VideoFrameExtractionProgress) => void
  readonly signal?: AbortSignal
}

export type PickVideoFramesDeps = PickVideoFramesRuntimeOptions & {
  /** Overridable so a test drives frame selection without a real video file
   *  or the native player/encoder; production leaves this at its default. */
  readonly extract?: (
    uri: string,
    options: PickVideoFramesRuntimeOptions
  ) => AsyncIterable<VideoFrameExtractionEvent>
}

/** Wires the real native player and encoder in, lazily: a static import of
 *  `mobile-video-frame-player.ts` here would pull `expo-video` in for every
 *  caller of this module, including one that never picks a video at all —
 *  and that chain carries react-native's Flow-typed entry, which breaks
 *  vitest's transform in a test that has no reason to touch it. The import
 *  runs only once a consumer actually asks this generator for its first
 *  value. */
async function* defaultExtract(
  uri: string,
  options: PickVideoFramesRuntimeOptions
): AsyncGenerator<VideoFrameExtractionEvent> {
  const { createNativeVideoFramePlayer, encodeNativeVideoFrame } = await import('./mobile-video-frame-player')
  yield* extractVideoFrames(uri, {
    ...options,
    createPlayer: createNativeVideoFramePlayer,
    encodeFrame: encodeNativeVideoFrame
  })
}

function asVideoFrameExtractionError(error: unknown): VideoFrameExtractionError | VideoFrameExtractionCancelledError {
  if (error instanceof VideoFrameExtractionCancelledError || error instanceof VideoFrameExtractionError) {
    return error
  }
  return new VideoFrameExtractionError(error instanceof Error ? error.message : String(error))
}

/**
 * Extracts `asset`'s frames and yields each as an ordinary picked image
 * carrying `videoFrame` metadata, so the chip strip draws it like any other
 * photo and the sent note groups them back together
 * (`mobile-native-chat-video-frames-attachment.ts`).
 *
 * Yields a frame the moment it is encoded — never after the whole video has
 * been read — so the caller can start that frame's upload immediately and
 * a cancel between frames takes effect before the next one is even pulled.
 * `previewBase64` (not the full upload-quality `base64`) is what the picked
 * image's `uri` carries: the chip strip never needs more than a small copy.
 *
 * Never reads the video's own bytes into JS: duration and frames come from
 * `expo-video`'s headless player and `expo-image-manipulator`
 * (`mobile-video-frame-player.ts`), not from `expo-file-system`.
 */
export async function* pickVideoFrames(
  asset: { uri: string; name?: string | null },
  sourceSizeBytes: number | null,
  deps?: PickVideoFramesDeps
): AsyncGenerator<PickedMobileImage> {
  const extract = deps?.extract ?? defaultExtract
  const sourceName = asset.name || asset.uri.split('/').pop() || 'video'
  videoFrameGroupCounter += 1
  const groupId = `video-frames-${videoFrameGroupCounter}`
  let meta: VideoFrameExtractionMeta | null = null
  try {
    for await (const event of extract(asset.uri, { onProgress: deps?.onProgress, signal: deps?.signal })) {
      if (event.kind === 'meta') {
        meta = event
        continue
      }
      // A conforming `extract` always yields `meta` first; this only guards
      // an injected test double or a future implementation that forgets to.
      if (!meta) {
        throw new VideoFrameExtractionError('This video reported a frame before its metadata')
      }
      const videoFrame: VideoFrameAttachmentMeta = {
        groupId,
        index: event.frame.index,
        total: meta.total,
        sourceName,
        durationLabel: formatVideoFrameDurationLabel(meta.durationMs),
        intervalLabel: formatVideoFrameIntervalLabel(meta.intervalMs),
        intervalMs: meta.intervalMs,
        sourceSizeLabel: formatVideoFrameSizeLabel(sourceSizeBytes)
      }
      yield {
        base64: event.frame.base64,
        uri: `data:image/jpeg;base64,${event.frame.previewBase64}`,
        videoFrame
      }
    }
  } catch (error) {
    throw asVideoFrameExtractionError(error)
  }
}

/** Reset between tests: the group id counter is module state so two frames
 *  from the same pick always share one id even across repeated picks. */
export function resetVideoFrameGroupCounterForTests(): void {
  videoFrameGroupCounter = 0
}
