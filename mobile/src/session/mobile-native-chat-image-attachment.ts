import { saveMobileClipboardImageAsTempFile } from './mobile-clipboard-image'
import type { MobileClipboardImageRpcSender } from './mobile-clipboard-image-operations'
// Type-only import so this module (and its unit test) stays free of the expo/
// react-native picker chain; the concrete `pickImage` is injected by the hook.
import type { MobileImageSource, PickedMobileImage } from './mobile-image-source-picker'
import type { VideoFrameAttachmentMeta } from '../platform/media-picker-contract'

/** A picked-and-uploaded image held in the native-chat composer until submit.
 *  `path` is the host temp file pasted into the agent on send; `previewUri` is a
 *  local URI used only to render the composer thumbnail. */
export type PendingNativeChatImage = {
  readonly id: string
  readonly path: string
  readonly previewUri: string
  /** Documents share the image upload channel but are described to the agent
   *  in text instead of being pasted as an image. Absent means image. */
  readonly kind?: 'image' | 'file'
  readonly name?: string
  /** Set on a still frame pulled from an over-the-cap video: it rides as an
   *  ordinary image chip (no `.name`, so `kind` stays "image"), and this is
   *  what groups it with its siblings for the note
   *  (`mobile-native-chat-video-frames-attachment.ts`). */
  readonly videoFrame?: VideoFrameAttachmentMeta
  /** Bytes on their way to the host, from a pick (`path` still empty) or
   *  from markup's Done (`path` still the photo as it was): drawn as a chip
   *  with a spinner (2026-09-13, the Claude app's per-file loading ring). A
   *  send tapped now waits for it (use-mobile-native-chat-send-chips.ts). */
  readonly uploading?: boolean
  /** Which selection put this chip here. One selection's sweep must not clear
   *  another's chips: picking a large video then a small photo let the photo
   *  settle first and delete the video's chip, and the video never went with
   *  the message (2026-09-13). */
  readonly batch?: string
}

/** What a chip can show before the host has the bytes: no path yet. */
export type UploadingNativeChatImage = Omit<PendingNativeChatImage, 'id' | 'path' | 'uploading'>

export function appendPendingNativeChatImages(
  current: readonly PendingNativeChatImage[],
  uploaded: readonly Omit<PendingNativeChatImage, 'id'>[],
  idCounter: { current: number }
): PendingNativeChatImage[] {
  // An upload that announced itself already holds a chip; the finished
  // image takes that chip's place and id, so the strip does not reshuffle.
  // Its own selection's chip: the same photo picked twice draws two chips
  // with one picture, and the pick that landed first filled the other's,
  // whose sweep then took the chip still on its way (2026-09-26 review).
  const next = [...current]
  for (const image of uploaded) {
    const slot = next.findIndex(
      (chip) => chip.uploading && chip.previewUri === image.previewUri && chip.batch === image.batch
    )
    if (slot !== -1) {
      const { uploading: _done, ...rest } = next[slot] as PendingNativeChatImage
      next[slot] = { ...rest, ...image }
      continue
    }
    idCounter.current += 1
    next.push({ id: `img-${idCounter.current}`, ...image })
  }
  return next
}

export function addUploadingNativeChatImage(
  current: readonly PendingNativeChatImage[],
  image: UploadingNativeChatImage,
  idCounter: { current: number }
): PendingNativeChatImage[] {
  idCounter.current += 1
  return [...current, { id: `img-${idCounter.current}`, path: '', uploading: true, ...image }]
}

/** Drop chips whose upload never finished (the selection failed or was cut
 *  off), from ONE selection when a batch is named. */
export function dropUploadingNativeChatImages(
  current: readonly PendingNativeChatImage[],
  batch?: string
): PendingNativeChatImage[] {
  const stranded = (chip: PendingNativeChatImage): boolean =>
    chip.uploading === true && (batch === undefined || chip.batch === batch)
  return current.some(stranded) ? current.filter((chip) => !stranded(chip)) : [...current]
}

/** Swaps one attachment's bytes for a marked-up version, keeping its id,
 *  kind and name so the chip's position and label do not change, and settles
 *  it. Used by the markup editor's Done, and to put the photo back when that
 *  upload fails; a stale id (the chip was removed or already sent while the
 *  editor was open) is a no-op rather than resurrecting it. */
export function replaceNativeChatImageAttachment(
  current: readonly PendingNativeChatImage[],
  id: string,
  next: { path: string; previewUri: string }
): PendingNativeChatImage[] {
  const index = current.findIndex((attachment) => attachment.id === id)
  if (index === -1) {
    return [...current]
  }
  const updated = [...current]
  const { uploading: _settled, ...chip } = updated[index]!
  updated[index] = { ...chip, ...next }
  return updated
}

/** The picture a marked-up chip shows. The chip takes it the moment Done is
 *  tapped and the finished upload carries the same string, so a send waiting
 *  on the chip can tell the marks landed from the photo being put back. */
export function markedUpNativeChatImagePreviewUri(base64: string): string {
  return `data:image/png;base64,${base64}`
}

/** Draws a chip as uploading again while its marked-up bytes go to the host
 *  (2026-09-26: the re-upload never marked its chip, so a send tapped just
 *  after Done pasted the photo without its marks). It keeps its path, so a
 *  send that gives up waiting still has the photo, and drops its batch, so no
 *  selection's sweep of stranded chips can take it. */
export function markNativeChatImageReuploading(
  current: readonly PendingNativeChatImage[],
  id: string,
  previewUri: string
): PendingNativeChatImage[] {
  const index = current.findIndex((attachment) => attachment.id === id)
  if (index === -1) {
    return [...current]
  }
  const updated = [...current]
  const { batch: _swept, ...chip } = updated[index]!
  updated[index] = { ...chip, previewUri, uploading: true }
  return updated
}

export type UploadMarkedUpImageDeps = {
  readonly client: MobileClipboardImageRpcSender
  readonly getConnectionId: () => Promise<string | null>
}

/** Re-uploads a flattened markup PNG the same way the original picker upload
 *  did (`uploadMobileNativeChatImages`'s per-image step), so what rides to
 *  the agent on send is the marked-up bytes, not the original photo. */
export async function uploadMarkedUpNativeChatImage(
  base64: string,
  { client, getConnectionId }: UploadMarkedUpImageDeps
): Promise<{ path: string; previewUri: string }> {
  const connectionId = await getConnectionId()
  const path = await saveMobileClipboardImageAsTempFile(client, base64, { connectionId })
  return { path, previewUri: markedUpNativeChatImagePreviewUri(base64) }
}

export type UploadNativeChatImagesDeps = {
  readonly client: MobileClipboardImageRpcSender
  readonly getConnectionId: () => Promise<string | null>
  // Injected so this module stays free of expo/react-native imports (unit-testable).
  readonly pickImages: (
    source: MobileImageSource
  ) =>
    | Iterable<PickedMobileImage>
    | AsyncIterable<PickedMobileImage>
    | Promise<Iterable<PickedMobileImage> | AsyncIterable<PickedMobileImage>>
  // Fired once the user has picked an image and the host upload is about to start —
  // lets the UI show the attach spinner only for the transfer, not the picker.
  readonly onUploadStart?: () => void
  /** Fired per picked file before its bytes go up, so a chip can appear at once. */
  readonly onImageStart?: (image: UploadingNativeChatImage) => void
  /** Retains each completed upload if a later image in the same selection fails. */
  readonly onImageUploaded?: (image: Omit<PendingNativeChatImage, 'id'>) => void
}

/** Picks an image and uploads it to the host, returning the host path + a local
 *  preview URI — but does NOT paste it into the terminal. Unlike the terminal
 *  attach flow, native chat holds the image as a composer chip and rides it along
 *  on submit (desktop parity), so the chip and the agent input never diverge.
 *  Returns an empty array when the user cancels the picker. */
export async function uploadMobileNativeChatImages(
  source: MobileImageSource,
  {
    client,
    getConnectionId,
    pickImages,
    onUploadStart,
    onImageStart,
    onImageUploaded
  }: UploadNativeChatImagesDeps
): Promise<Omit<PendingNativeChatImage, 'id'>[]> {
  const picked = await pickImages(source)
  const uploaded: Omit<PendingNativeChatImage, 'id'>[] = []
  let connectionId: string | null = null
  for await (const image of picked) {
    if (uploaded.length === 0) {
      onUploadStart?.()
      connectionId = await getConnectionId()
    }
    // Prefer the picker's local URI for the thumbnail; fall back to an inline data
    // URI when the source omitted one (RN <Image> renders both).
    const previewUri = image.uri ?? `data:image/png;base64,${image.base64}`
    onImageStart?.(
      image.name
        ? { previewUri, kind: 'file', name: image.name }
        : image.videoFrame
          ? { previewUri, videoFrame: image.videoFrame }
          : { previewUri }
    )
    // The chip is up; now the bytes, which a photo reads (and scales) on demand.
    const base64 = image.base64 || (image.load ? await image.load() : '')
    if (!base64) {
      continue
    }
    const path = await saveMobileClipboardImageAsTempFile(client, base64, { connectionId })
    const result = image.name
      ? { path, previewUri, kind: 'file' as const, name: image.name }
      : image.videoFrame
        ? { path, previewUri, videoFrame: image.videoFrame }
        : { path, previewUri }
    uploaded.push(result)
    onImageUploaded?.(result)
  }
  return uploaded
}
