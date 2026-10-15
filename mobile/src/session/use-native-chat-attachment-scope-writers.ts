import { useCallback } from 'react'
import {
  addUploadingNativeChatImage,
  appendPendingNativeChatImages,
  dropUploadingNativeChatImages,
  failUploadingNativeChatImage,
  markNativeChatImageReuploading,
  replaceNativeChatImageAttachment,
  type NativeChatUploadLanded,
  type PendingNativeChatImage,
  type UploadingNativeChatImage
} from './mobile-native-chat-image-attachment'
import { withScopeAttachments } from './mobile-native-chat-image-scope-state'
import {
  forgetNativeChatUploadRetry,
  registerNativeChatUploadRetry
} from './mobile-native-chat-upload-retry'
import {
  nativeChatChipIdCounter,
  nativeChatRemovedUploads,
  removedUploadKey,
  useNativeChatImageAttachmentsStore,
  type NativeChatVideoFrameExtractionState
} from './mobile-native-chat-image-attachments-store'

/** The writes an upload makes to a tab's chip strip: a chip when a file is
 *  picked, the finished upload into that chip, and the sweep of chips whose
 *  upload never finished. Split from the attachments hook for its line ceiling. */
export function useNativeChatAttachmentScopeWriters(
  showToast?: (message: string, durationMs?: number) => void
) {
  const setAttachmentsByScope = useNativeChatImageAttachmentsStore((state) => state.update)
  const addUploadedImages = useCallback(
    (scope: string, landed: Omit<PendingNativeChatImage, 'id'>[]) => {
      // A picture whose chip was removed while it went up stays out.
      const uploadedImages = landed.filter(
        (image) => !nativeChatRemovedUploads.uploads.delete(removedUploadKey(scope, image.batch, image.previewUri))
      )
      if (uploadedImages.length === 0) {
        return
      }
      setAttachmentsByScope((prev) => ({
        ...prev,
        [scope]: appendPendingNativeChatImages(prev[scope] ?? [], uploadedImages, nativeChatChipIdCounter)
      }))
    },
    [setAttachmentsByScope]
  )
  const addUploadingImage = useCallback(
    (scope: string, image: UploadingNativeChatImage) => {
      setAttachmentsByScope((prev) => ({
        ...prev,
        [scope]: addUploadingNativeChatImage(prev[scope] ?? [], image, nativeChatChipIdCounter)
      }))
    },
    [setAttachmentsByScope]
  )
  // A picture whose upload failed keeps its chip, marked failed, with its
  // retry kept under the chip's id; a retry that fails too says why.
  const markUploadFailed = useCallback(
    (
      scope: string,
      image: { previewUri: string; batch?: string },
      retry: () => Promise<NativeChatUploadLanded>
    ): boolean => {
      if (nativeChatRemovedUploads.uploads.delete(removedUploadKey(scope, image.batch, image.previewUri))) {
        return false
      }
      const current = useNativeChatImageAttachmentsStore.getState().byScope[scope] ?? []
      const { chips, id } = failUploadingNativeChatImage(current, image)
      if (id === null) {
        return false
      }
      setAttachmentsByScope((prev) => withScopeAttachments(prev, scope, chips))
      registerNativeChatUploadRetry(id, {
        scope,
        run: retry,
        onFailed: (error) =>
          showToast?.(`Upload failed: ${error instanceof Error ? error.message : String(error)}`, 2000)
      })
      return true
    },
    [setAttachmentsByScope, showToast]
  )
  // The chip's remove badge, in every state as in the Claude app. A failed
  // chip's retry goes with it: it holds the picture's bytes, up to megabytes
  // for a photo. Every removal leaves a mark, so a send waiting beside the chip
  // goes without it; one still uploading also marks its picture, so its
  // landing (or its failure) cannot draw it again.
  const removeScopeAttachment = useCallback(
    (scope: string, id: string) => {
      forgetNativeChatUploadRetry(id)
      const chip = useNativeChatImageAttachmentsStore.getState().byScope[scope]?.find((c) => c.id === id)
      // Any chip a send may be waiting beside, landed or not (Opus review, 2026-10-12).
      if (chip) {
        nativeChatRemovedUploads.ids.add(id)
      }
      if (chip?.uploading) {
        // A retry or a markup save lands by chip id, which is gone already.
        if (chip.batch !== undefined) {
          nativeChatRemovedUploads.uploads.add(removedUploadKey(scope, chip.batch, chip.previewUri))
        }
      }
      setAttachmentsByScope((prev) =>
        withScopeAttachments(prev, scope, (prev[scope] ?? []).filter((attachment) => attachment.id !== id))
      )
    },
    [setAttachmentsByScope]
  )
  const settleUploads = useCallback(
    (scope: string, batch?: string) => {
      setAttachmentsByScope((prev) =>
        withScopeAttachments(prev, scope, dropUploadingNativeChatImages(prev[scope] ?? [], batch))
      )
    },
    [setAttachmentsByScope]
  )
  // The markup editor's Done draws the chip uploading with its marks, then
  // swaps its bytes for the marked-up version once the re-upload finishes, or
  // puts the chip back as it was when it fails
  // (use-mobile-native-chat-image-markup.ts owns the upload itself, split out
  // for the same reason this file is). The mark returns that chip, or null
  // when the scope holds none by that id or it is uploading already: a quick
  // second tap on Done put the first tap's uploading chip back when its own
  // upload failed, and the chip never settled (2026-09-26 review).
  const markAttachmentReuploading = useCallback(
    (scope: string, id: string, previewUri: string): PendingNativeChatImage | null => {
      const before = useNativeChatImageAttachmentsStore.getState().byScope[scope]?.find((chip) => chip.id === id)
      if (!before || before.uploading) {
        return null
      }
      setAttachmentsByScope((prev) =>
        withScopeAttachments(prev, scope, markNativeChatImageReuploading(prev[scope] ?? [], id, previewUri))
      )
      return before
    },
    [setAttachmentsByScope]
  )
  const replaceAttachmentImage = useCallback(
    (
      scope: string,
      id: string,
      next: { path: string; previewUri: string }
    ) => {
      setAttachmentsByScope((prev) =>
        withScopeAttachments(prev, scope, replaceNativeChatImageAttachment(prev[scope] ?? [], id, next))
      )
    },
    [setAttachmentsByScope]
  )
  // A send takes its chips out of the strip as it starts, and a send that fails
  // before its text goes puts them back at the front, in the order they were.
  const takeSentAttachments = useCallback(
    (scope: string, sent: readonly PendingNativeChatImage[]) => {
      const sentIds = new Set(sent.map((chip) => chip.id))
      setAttachmentsByScope((prev) =>
        withScopeAttachments(prev, scope, (prev[scope] ?? []).filter((chip) => !sentIds.has(chip.id)))
      )
    },
    [setAttachmentsByScope]
  )
  const restoreSentAttachments = useCallback(
    (scope: string, sent: readonly PendingNativeChatImage[]) => {
      setAttachmentsByScope((prev) => withScopeAttachments(prev, scope, [...sent, ...(prev[scope] ?? [])]))
    },
    [setAttachmentsByScope]
  )
  const setVideoFrameExtractionUpdate = useNativeChatImageAttachmentsStore(
    (state) => state.updateVideoFrameExtraction
  )
  // Null clears the scope's entry entirely: an absent key, not a null value,
  // is what `extractionByScope[scope]` reading `undefined` depends on.
  const setVideoFrameExtractionProgress = useCallback(
    (scope: string, progress: NativeChatVideoFrameExtractionState | null) => {
      setVideoFrameExtractionUpdate((prev) => {
        if (progress === null) {
          if (!(scope in prev)) {
            return prev
          }
          const next = { ...prev }
          delete next[scope]
          return next
        }
        return { ...prev, [scope]: progress }
      })
    },
    [setVideoFrameExtractionUpdate]
  )
  return {
    setAttachmentsByScope,
    addUploadedImages,
    addUploadingImage,
    markUploadFailed,
    removeScopeAttachment,
    settleUploads,
    markAttachmentReuploading,
    replaceAttachmentImage,
    takeSentAttachments,
    restoreSentAttachments,
    setVideoFrameExtractionProgress
  }
}
