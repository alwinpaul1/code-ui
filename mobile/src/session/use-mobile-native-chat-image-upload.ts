import type { UploadingNativeChatImage } from './mobile-native-chat-image-attachment'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { CLIPBOARD_IMAGE_TOO_LARGE_ERROR } from '../../../src/shared/clipboard-image'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { useMediaPicker } from '../platform/media-picker'
import {
  ImageLibraryPermissionError,
  type MobileImageSource
} from '../platform/media-picker-contract'
// A file the composer already holds and a named document are this fork's own attach paths, and
// the media seam's contract has no member for either, so they stay on the phone's picker.
import { pickMobileDocuments, pickMobileImageFiles } from './mobile-image-source-picker'
import {
  uploadMobileNativeChatImages,
  type PendingNativeChatImage
} from './mobile-native-chat-image-attachment'
import {
  describeVideoFrameExtractionFailure,
  VideoFrameExtractionCancelledError,
  VideoFrameExtractionError
} from './mobile-video-frame-extractor'
import type { VideoFrameExtractionProgress } from './mobile-video-frame-extractor'

type CurrentRef<T> = { readonly current: T }
type UploadedNativeChatImage = Omit<PendingNativeChatImage, 'id'>
type ShowToast = (message: string, durationMs?: number) => void

// Counted for the app, not per mount: a selection's sweep takes the chips
// still uploading under its name, and those chips outlive the composer in a
// module-level store. A remount named its first selection batch-1 again, so
// the earlier mount's sweep took a photo the new one was still uploading
// (2026-09-26 review).
let nativeChatUploadBatches = 0

export function useMobileNativeChatImageUpload(args: {
  client: RpcClient | null
  activeHandleRef: CurrentRef<string | null>
  getActiveWorktreeConnectionId: () => Promise<string | null>
  connState: ConnectionState
  scopeKey: string | null
  structuredNativeChat: boolean
  showToast: ShowToast
  onImagesUploaded: (scope: string, images: UploadedNativeChatImage[]) => void
  /** A picked file is on its way: show its chip now, with a spinner. */
  onImageUploading?: (scope: string, image: UploadingNativeChatImage) => void
  /** The selection is done, successful or not: chips still marked uploading are stale. */
  onUploadSettled?: (scope: string, batch?: string) => void
  /** A document attach is reading an over-the-cap video's frames — drawn
   *  beside the chips, not as one (`mobile-native-chat-image-attachments-store.ts`).
   *  `null` once the attach settles, extracted or not. */
  onVideoFrameExtractionProgress?: (scope: string, progress: VideoFrameExtractionProgress | null) => void
  onAttachSuccess?: () => void
  onError?: () => void
}): {
  attachImage: (source: MobileImageSource) => Promise<void>
  attachImageFile: (uri: string) => Promise<void>
  attachDocument: () => Promise<void>
  /** Stops a document attach's frame extraction in progress; a no-op once it
   *  has already settled. */
  cancelVideoFrameExtraction: () => void
  isAttaching: boolean
} {
  const {
    activeHandleRef,
    client,
    connState,
    getActiveWorktreeConnectionId,
    onAttachSuccess,
    onError,
    onImagesUploaded,
    onImageUploading,
    onUploadSettled,
    onVideoFrameExtractionProgress,
    scopeKey,
    showToast,
    structuredNativeChat
  } = args
  const [isAttaching, setIsAttaching] = useState(false)
  const picker = useMediaPicker()
  const attachingCount = useRef(0)
  const connStateRef = useRef(connState)
  const videoFrameExtractionAbortRef = useRef<AbortController | null>(null)
  useLayoutEffect(() => {
    connStateRef.current = connState
  }, [connState])
  const cancelVideoFrameExtraction = useCallback(() => {
    videoFrameExtractionAbortRef.current?.abort()
  }, [])

  const attachWith = useCallback(
    async (
      pickImages: Parameters<typeof uploadMobileNativeChatImages>[1]['pickImages'],
      source: MobileImageSource
    ): Promise<void> => {
      const scope = scopeKey
      if (
        !client ||
        !scope ||
        connState !== 'connected' ||
        (!activeHandleRef.current && !structuredNativeChat)
      ) {
        return
      }
      let started = false
      nativeChatUploadBatches += 1
      const batch = `batch-${nativeChatUploadBatches}`
      const uploadedImages: UploadedNativeChatImage[] = []
      let uploadError: unknown = null
      try {
        await uploadMobileNativeChatImages(source, {
          client,
          getConnectionId: getActiveWorktreeConnectionId,
          pickImages,
          onImageUploaded: (image) => uploadedImages.push({ ...image, batch }),
          onImageStart: (image) => onImageUploading?.(scope, { ...image, batch }),
          onUploadStart: () => {
            started = true
            attachingCount.current += 1
            setIsAttaching(true)
          }
        })
      } catch (error) {
        uploadError = error
      } finally {
        if (started) {
          attachingCount.current -= 1
          if (attachingCount.current === 0) {
            setIsAttaching(false)
          }
        }
        // Whatever the outcome, this attach is no longer reading frames.
        onVideoFrameExtractionProgress?.(scope, null)
      }
      if (uploadedImages.length > 0) {
        onImagesUploaded(scope, uploadedImages)
        onAttachSuccess?.()
      }
      onUploadSettled?.(scope, batch)
      if (uploadError !== null) {
        // A cancelled extraction is the user changing their mind, like a
        // dismissed picker — no toast, same as `result.canceled` never
        // reaching this catch at all.
        if (uploadError instanceof VideoFrameExtractionCancelledError) {
          return
        }
        const message = uploadError instanceof Error ? uploadError.message : String(uploadError)
        onError?.()
        if (connStateRef.current !== 'connected') {
          showToast('Attach failed (disconnected)', 1500)
          return
        }
        if (uploadError instanceof ImageLibraryPermissionError) {
          showToast('Photo permission denied', 1500)
          return
        }
        if (uploadError instanceof VideoFrameExtractionError) {
          // The video is still over the cap — extraction was the alternative
          // to refusing it outright, and that alternative just failed too, so
          // the same "too large" story stands, with a short reason (never the
          // raw native exception text) appended.
          showToast(
            `File too large to attach (18 MB max) — the video ${describeVideoFrameExtractionFailure(uploadError)}`,
            1500
          )
          return
        }
        if (message === CLIPBOARD_IMAGE_TOO_LARGE_ERROR) {
          showToast('File too large to attach (18 MB max)', 1500)
          return
        }
        showToast('Attach failed', 1500)
      }
    },
    [
      activeHandleRef,
      client,
      connState,
      getActiveWorktreeConnectionId,
      onAttachSuccess,
      onError,
      onImagesUploaded,
      onImageUploading,
      onUploadSettled,
      onVideoFrameExtractionProgress,
      scopeKey,
      showToast,
      structuredNativeChat
    ]
  )

  const attachImage = useCallback(
    (source: MobileImageSource) => attachWith(picker.pickImages, source),
    [attachWith, picker]
  )
  const attachImageFile = useCallback(
    (uri: string) => attachWith(() => pickMobileImageFiles([uri]), 'files'),
    [attachWith]
  )
  const attachDocument = useCallback(() => {
    // A second video attach while one is still reading frames would overwrite
    // this ref (so cancel could only ever reach the newer one) and both would
    // write the same scope's single progress slot (2026-09-27 review) —
    // refuse rather than let either happen.
    if (videoFrameExtractionAbortRef.current) {
      showToast('Already reading a video — wait for it to finish', 1500)
      return Promise.resolve()
    }
    const controller = new AbortController()
    videoFrameExtractionAbortRef.current = controller
    return attachWith(
      () =>
        pickMobileDocuments(undefined, undefined, {
          signal: controller.signal,
          onProgress: (progress) => {
            const scope = scopeKey
            if (!scope) {
              return
            }
            onVideoFrameExtractionProgress?.(scope, progress)
            // The chip clears the moment reading finishes, not once the last
            // frame's own upload also finishes — those are two different
            // things once frames upload one at a time as they are read
            // (2026-09-27 review).
            if (progress.done === progress.total) {
              onVideoFrameExtractionProgress?.(scope, null)
            }
          }
        }),
      'files'
    ).finally(() => {
      videoFrameExtractionAbortRef.current = null
    })
  }, [attachWith, onVideoFrameExtractionProgress, scopeKey, showToast])

  return { attachImage, attachImageFile, attachDocument, cancelVideoFrameExtraction, isAttaching }
}
