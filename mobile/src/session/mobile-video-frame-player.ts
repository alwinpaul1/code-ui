import { createVideoPlayer } from 'expo-video'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import {
  VideoFrameExtractionError,
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
    generateThumbnails: (timesSec, maxEdge) =>
      player.generateThumbnailsAsync(timesSec, { maxWidth: maxEdge, maxHeight: maxEdge }),
    release: () => player.release()
  }
}

export const encodeNativeVideoFrame: VideoFrameEncoder = async (thumbnail, quality) => {
  const context = ImageManipulator.manipulate(thumbnail as Parameters<typeof ImageManipulator.manipulate>[0])
  try {
    const rendered = await context.renderAsync()
    try {
      const result = await rendered.saveAsync({ format: SaveFormat.JPEG, base64: true, compress: quality })
      if (!result.base64) {
        throw new VideoFrameExtractionError('Could not encode a frame from this video')
      }
      return { base64: result.base64 }
    } finally {
      rendered.release()
    }
  } finally {
    context.release()
  }
}
