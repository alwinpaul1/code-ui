import { createVideoPlayer } from 'expo-video'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { File as FsFile } from 'expo-file-system'
import {
  VideoFrameExtractionError,
  VIDEO_FRAME_PREVIEW_MAX_EDGE,
  VIDEO_FRAME_PREVIEW_QUALITY,
  type VideoFrameEncoder,
  type VideoFramePlayer
} from './mobile-video-frame-extractor'

/**
 * The one place this feature touches `expo-video` and `expo-image-manipulator`.
 *
 * `expo-video-thumbnails` (Expo's dedicated thumbnail module) cannot read a
 * video's duration at all — its native source (`MediaMetadataRetriever`) is
 * never asked for `METADATA_KEY_DURATION`, only for a frame at a given time —
 * and frame selection needs the duration before it can choose any timestamps.
 * `expo-video`'s headless player (`createVideoPlayer`, no `<VideoView>`
 * mounted) already reports `duration` once its status is `readyToPlay`, and
 * its own `generateThumbnailsAsync` accepts `maxWidth`/`maxHeight` and returns
 * `VideoThumbnail`s that are themselves `SharedRef<'image'>`s — exactly what
 * `ImageManipulator.manipulate()` already accepts as a source. So `expo-video`
 * alone covers both needs and `expo-video-thumbnails` is not a dependency
 * here at all.
 */
export function createNativeVideoFramePlayer(uri: string): VideoFramePlayer {
  const player = createVideoPlayer(uri)
  return {
    get duration() {
      return player.duration
    },
    waitUntilReady: () =>
      new Promise<void>((resolve, reject) => {
        if (player.status === 'readyToPlay') {
          resolve()
          return
        }
        if (player.status === 'error') {
          reject(new VideoFrameExtractionError('This video could not be read'))
          return
        }
        const subscription = player.addListener('statusChange', ({ status, error }) => {
          if (status === 'readyToPlay') {
            subscription.remove()
            resolve()
          } else if (status === 'error') {
            subscription.remove()
            reject(new VideoFrameExtractionError(error?.message ?? 'This video could not be read'))
          }
        })
      }),
    // `VideoThumbnail` already carries `width`/`height` (and `release()`, from
    // `SharedObject`), so the native result satisfies `VideoFrameThumbnail` as-is.
    generateThumbnails: (timesSec, maxEdge) =>
      player.generateThumbnailsAsync(timesSec, { maxWidth: maxEdge, maxHeight: maxEdge }),
    release: () => player.release()
  }
}

type ManipulatableSource = Parameters<typeof ImageManipulator.manipulate>[0]

/** Scales `width`×`height` down so its longest edge fits `maxEdge`, aspect
 *  preserved — unchanged if it already fits. Mirrors `photoTarget` in
 *  `mobile-image-source-picker.ts` (the same "fit within a box" shape), kept
 *  separate since that one is camera/library-only and free of this chain. */
function fitWithinEdge(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) {
    return { width, height }
  }
  const scale = maxEdge / longest
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** Best-effort delete of `ImageManipulator`'s own cache file: `.release()`
 *  only frees the native image reference, not the JPEG it wrote to
 *  `cacheDir/ImageManipulator` (2026-09-27 review — twenty frames' worth of
 *  those, per video, were never cleaned up at all). Never lets a cleanup
 *  failure hide whatever the caller is about to return or throw. */
function deleteManipulatorFileQuietly(uri: string | undefined): void {
  if (!uri) {
    return
  }
  try {
    new FsFile(uri).delete()
  } catch {
    // Best-effort; the OS reclaims the cache directory regardless.
  }
}

/** Renders `source` once, optionally resized, and returns its JPEG base64.
 *  Releases both the manipulation context and the rendered image in `finally`
 *  regardless of success — a `null` decode later than this leaves nothing
 *  native still held — and deletes the cache file `saveAsync` wrote once its
 *  base64 has been read, success or failure alike. */
async function renderVideoFrameBase64(
  source: ManipulatableSource,
  options: { readonly resizeTo?: { width: number; height: number }; readonly quality: number }
): Promise<string> {
  const context = ImageManipulator.manipulate(source)
  try {
    if (options.resizeTo) {
      context.resize(options.resizeTo)
    }
    const rendered = await context.renderAsync()
    try {
      const result = await rendered.saveAsync({ format: SaveFormat.JPEG, base64: true, compress: options.quality })
      try {
        if (!result.base64) {
          throw new VideoFrameExtractionError('Could not encode a frame from this video')
        }
        return result.base64
      } finally {
        deleteManipulatorFileQuietly(result.uri)
      }
    } finally {
      rendered.release()
    }
  } finally {
    context.release()
  }
}

/** Renders the frame twice from the one decoded thumbnail: once at upload
 *  quality, once downscaled for the chip's own preview — so the composer's
 *  attachment store never holds the full-size bytes of up to 20 frames at
 *  once while the user is still composing (2026-09-27 review). */
export const encodeNativeVideoFrame: VideoFrameEncoder = async (thumbnail, quality) => {
  const source = thumbnail as unknown as ManipulatableSource
  const base64 = await renderVideoFrameBase64(source, { quality })
  const previewBase64 = await renderVideoFrameBase64(source, {
    resizeTo: fitWithinEdge(thumbnail.width, thumbnail.height, VIDEO_FRAME_PREVIEW_MAX_EDGE),
    quality: VIDEO_FRAME_PREVIEW_QUALITY
  })
  return { base64, previewBase64 }
}
