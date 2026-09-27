import { CLIPBOARD_IMAGE_MAX_SOURCE_BYTES } from '../../../src/shared/clipboard-image'
import type { PickedMobileImage, VideoFrameAttachmentMeta } from '../platform/media-picker-contract'
import {
  extractVideoFrames,
  formatVideoFrameDurationLabel,
  formatVideoFrameIntervalLabel,
  formatVideoFrameSizeLabel,
  VideoFrameExtractionCancelledError,
  VideoFrameExtractionError,
  type VideoFrameExtractionProgress,
  type VideoFrameExtractionResult
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

/** Over the desktop's phone-upload cap, or not provably at or under it.
 *  Unknown size stays on the frame-extraction path rather than risk reading
 *  an unproven-small video's whole bytes into JS memory. */
export function isVideoOverUploadCap(sizeBytes: number | null): boolean {
  return sizeBytes === null || sizeBytes > CLIPBOARD_IMAGE_MAX_SOURCE_BYTES
}

let videoFrameGroupCounter = 0

export type PickVideoFramesRuntimeOptions = {
  readonly onProgress?: (progress: VideoFrameExtractionProgress) => void
  readonly signal?: AbortSignal
}

export type PickVideoFramesDeps = PickVideoFramesRuntimeOptions & {
  /** Overridable so a test drives frame selection without a real video file
   *  or the native player/encoder; production leaves this at its default. */
  readonly extract?: (uri: string, options: PickVideoFramesRuntimeOptions) => Promise<VideoFrameExtractionResult>
}

/** Wires the real native player and encoder in, lazily: a static import of
 *  `mobile-video-frame-player.ts` here would pull `expo-video` in for every
 *  caller of this module, including one that never picks a video at all —
 *  and that chain carries react-native's Flow-typed entry, which breaks
 *  vitest's transform in a test that has no reason to touch it. Reached only
 *  once a video actually needs its frames read. */
async function defaultExtract(
  uri: string,
  options: PickVideoFramesRuntimeOptions
): Promise<VideoFrameExtractionResult> {
  const { createNativeVideoFramePlayer, encodeNativeVideoFrame } = await import('./mobile-video-frame-player')
  return extractVideoFrames(uri, {
    ...options,
    createPlayer: createNativeVideoFramePlayer,
    encodeFrame: encodeNativeVideoFrame
  })
}

/**
 * Extracts `asset`'s frames and yields each as an ordinary picked image
 * carrying `videoFrame` metadata, so the chip strip draws it like any other
 * photo and the sent note groups them back together
 * (`mobile-native-chat-video-frames-attachment.ts`).
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
  let result: VideoFrameExtractionResult
  try {
    result = await extract(asset.uri, { onProgress: deps?.onProgress, signal: deps?.signal })
  } catch (error) {
    if (error instanceof VideoFrameExtractionCancelledError) {
      throw error
    }
    if (error instanceof VideoFrameExtractionError) {
      throw error
    }
    throw new VideoFrameExtractionError(error instanceof Error ? error.message : String(error))
  }
  videoFrameGroupCounter += 1
  const groupId = `video-frames-${videoFrameGroupCounter}`
  const total = result.frames.length
  const durationLabel = formatVideoFrameDurationLabel(result.durationMs)
  const intervalLabel = formatVideoFrameIntervalLabel(result.intervalMs)
  const sourceSizeLabel = formatVideoFrameSizeLabel(sourceSizeBytes)
  for (const frame of result.frames) {
    const videoFrame: VideoFrameAttachmentMeta = {
      groupId,
      index: frame.index,
      total,
      sourceName,
      durationLabel,
      intervalLabel,
      sourceSizeLabel
    }
    yield {
      base64: frame.base64,
      uri: `data:image/jpeg;base64,${frame.base64}`,
      videoFrame
    }
  }
}

/** Reset between tests: the group id counter is module state so two frames
 *  from the same pick always share one id even across repeated picks. */
export function resetVideoFrameGroupCounterForTests(): void {
  videoFrameGroupCounter = 0
}
