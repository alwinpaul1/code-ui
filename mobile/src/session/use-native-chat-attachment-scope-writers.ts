import { useCallback } from 'react'
import {
  addUploadingNativeChatImage,
  appendPendingNativeChatImages,
  dropUploadingNativeChatImages,
  markNativeChatImageReuploading,
  replaceNativeChatImageAttachment,
  type PendingNativeChatImage,
  type UploadingNativeChatImage
} from './mobile-native-chat-image-attachment'
import { withScopeAttachments } from './mobile-native-chat-image-scope-state'
import {
  nativeChatChipIdCounter,
  useNativeChatImageAttachmentsStore
} from './mobile-native-chat-image-attachments-store'

/** The writes an upload makes to a tab's chip strip: a chip when a file is
 *  picked, the finished upload into that chip, and the sweep of chips whose
 *  upload never finished. Split from the attachments hook for its line ceiling. */
export function useNativeChatAttachmentScopeWriters() {
  const setAttachmentsByScope = useNativeChatImageAttachmentsStore((state) => state.update)
  const addUploadedImages = useCallback(
    (scope: string, uploadedImages: Omit<PendingNativeChatImage, 'id'>[]) => {
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
      next: { path: string; previewUri: string; contentFingerprint?: string }
    ) => {
      setAttachmentsByScope((prev) =>
        withScopeAttachments(prev, scope, replaceNativeChatImageAttachment(prev[scope] ?? [], id, next))
      )
    },
    [setAttachmentsByScope]
  )
  return {
    setAttachmentsByScope,
    addUploadedImages,
    addUploadingImage,
    settleUploads,
    markAttachmentReuploading,
    replaceAttachmentImage
  }
}
