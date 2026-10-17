import { useEffect } from 'react'
import { create } from 'zustand'
import {
  VIDEO_FRAME_PREVIEW_MAX_EDGE,
  VIDEO_FRAME_PREVIEW_QUALITY,
  VIDEO_FRAME_READY_TIMEOUT_MS,
  VIDEO_FRAME_STEP_TIMEOUT_MS,
  type VideoFrameEncoder,
  type VideoFramePlayer
} from './mobile-video-frame-extractor'

/**
 * The picture a video chip shows in the composer strip, as the Claude app draws an uploading video
 * (1.261009.20 g330.c → f0f.d; 1.261013.20 l7f.d): a `video/*` attachment with a URI takes the
 * picture branch, its frame filling the 96 dp tile with the 32 dp ring over the centre, no scrim.
 * Code UI's `<Image>` cannot decode a video file, so the frame is made once on the phone with
 * `expo-video`'s `generateThumbnailsAsync` (already linked for the over-cap frame reader) and kept
 * as a small JPEG data URI, keyed by the video's own URI.
 *
 * Fail-open: a video whose frame cannot be made (an unreadable codec, a stalled player, no frame)
 * keeps the document card it had before, and says why once (2026-10-17, the user: "it loads in the
 * corner of attachment, see how Claude does that", for a screen recording).
 */

export type VideoChipPoster = { readonly status: 'pending' } | { readonly status: 'ready'; readonly uri: string } | { readonly status: 'failed' }

export type VideoChipPosterMaker = (videoUri: string) => Promise<string>

export type VideoChipPosterDeps = {
  readonly createPlayer: (uri: string) => VideoFramePlayer
  readonly encodeFrame: VideoFrameEncoder
  readonly readyTimeoutMs?: number
  readonly stepTimeoutMs?: number
}

function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms} ms`)), ms)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/** The video's first frame (Coil's video frame default, which the app loads the tile with), its
 *  long edge at most the chip preview's, as a JPEG data URI. Releases the player and the frame
 *  whatever happens. */
export async function makeVideoChipPoster(videoUri: string, deps: VideoChipPosterDeps): Promise<string> {
  const player = deps.createPlayer(videoUri)
  try {
    await withTimeout(player.waitUntilReady(), deps.readyTimeoutMs ?? VIDEO_FRAME_READY_TIMEOUT_MS, 'Opening the video')
    const step = deps.stepTimeoutMs ?? VIDEO_FRAME_STEP_TIMEOUT_MS
    const [frame] = await withTimeout(player.generateThumbnails([0], VIDEO_FRAME_PREVIEW_MAX_EDGE), step, 'Reading its first frame')
    if (!frame) {
      throw new Error('The video gave no frame')
    }
    try {
      const { previewBase64 } = await withTimeout(deps.encodeFrame(frame, VIDEO_FRAME_PREVIEW_QUALITY), step, 'Encoding its first frame')
      if (!previewBase64) {
        throw new Error('The frame encoded to nothing')
      }
      return `data:image/jpeg;base64,${previewBase64}`
    } finally {
      frame.release()
    }
  } finally {
    player.release()
  }
}

/** The production maker. `mobile-video-frame-player.ts` is imported only when a video chip asks:
 *  its chain reaches react-native's Flow-typed entry, which vitest cannot parse, the same reason
 *  `mobile-video-frame-picker.ts` imports it lazily (`defaultExtract`). */
const nativeMaker: VideoChipPosterMaker = async (videoUri) => {
  const { createNativeVideoFramePlayer, encodeNativeVideoFrame } = await import('./mobile-video-frame-player')
  return makeVideoChipPoster(videoUri, { createPlayer: createNativeVideoFramePlayer, encodeFrame: encodeNativeVideoFrame })
}

let maker: VideoChipPosterMaker = nativeMaker

const usePosterStore = create<{ posters: Record<string, VideoChipPoster> }>(() => ({ posters: {} }))

function setPoster(videoUri: string, poster: VideoChipPoster): void {
  usePosterStore.setState((state) => ({ posters: { ...state.posters, [videoUri]: poster } }))
}

/** Starts the frame for this video once; later calls for the same URI reuse it, failed or not, so a
 *  video that cannot be read warns once and is never retried on every render. */
export function requestVideoChipPoster(videoUri: string): void {
  if (!videoUri || usePosterStore.getState().posters[videoUri]) {
    return
  }
  setPoster(videoUri, { status: 'pending' })
  let made: Promise<string>
  try {
    made = maker(videoUri)
  } catch (error) {
    made = Promise.reject(error)
  }
  made.then(
    (uri) => setPoster(videoUri, { status: 'ready', uri }),
    (error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error)
      console.warn(`[video-chip-poster] no frame for the video chip, drawing the card instead: ${reason}`)
      setPoster(videoUri, { status: 'failed' })
    }
  )
}

/** The frames for the strip's video chips, each started the first time its chip is drawn, which is
 *  the moment it is attached (the chip goes into the strip as its upload starts). A video is in the
 *  result only once its frame is ready; one that failed never is. */
export function useVideoChipPosters(videoUris: readonly string[]): Readonly<Record<string, string>> {
  const posters = usePosterStore((state) => state.posters)
  const key = videoUris.join('\n')
  useEffect(() => {
    for (const videoUri of key ? key.split('\n') : []) {
      requestVideoChipPoster(videoUri)
    }
  }, [key])
  const ready: Record<string, string> = {}
  for (const videoUri of videoUris) {
    const poster = posters[videoUri]
    if (poster?.status === 'ready') {
      ready[videoUri] = poster.uri
    }
  }
  return ready
}

export function peekVideoChipPosterForTests(videoUri: string): VideoChipPoster | undefined {
  return usePosterStore.getState().posters[videoUri]
}

/** Clears every poster; `nextMaker` replaces the native one until the next reset. */
export function resetVideoChipPostersForTests(nextMaker?: VideoChipPosterMaker): void {
  usePosterStore.setState({ posters: {} })
  maker = nextMaker ?? nativeMaker
}
