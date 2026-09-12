import type { RpcClient } from '../transport/rpc-client'
import { saveMobileClipboardImageAsTempFile } from './mobile-clipboard-image'
// Type-only import so this module (and its unit test) stays free of the expo/
// react-native picker chain; the concrete `pickImage` is injected by the hook.
import type { MobileImageSource, PickedMobileImage } from './mobile-image-source-picker'

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
  /** Picked and on its way to the host: drawn as a chip with a spinner, not
   *  sendable yet (2026-09-13, the Claude app's per-file loading ring). */
  readonly uploading?: boolean
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
  const next = [...current]
  for (const image of uploaded) {
    const slot = next.findIndex((chip) => chip.uploading && chip.previewUri === image.previewUri)
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

/** Drop chips whose upload never finished (the selection failed or was cut off). */
export function dropUploadingNativeChatImages(
  current: readonly PendingNativeChatImage[]
): PendingNativeChatImage[] {
  return current.some((chip) => chip.uploading) ? current.filter((chip) => !chip.uploading) : [...current]
}

export type UploadNativeChatImagesDeps = {
  readonly client: Pick<RpcClient, 'sendRequest'>
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
    onImageStart?.(image.name ? { previewUri, kind: 'file', name: image.name } : { previewUri })
    const path = await saveMobileClipboardImageAsTempFile(client, image.base64, { connectionId })
    const result = image.name
      ? { path, previewUri, kind: 'file' as const, name: image.name }
      : { path, previewUri }
    uploaded.push(result)
    onImageUploaded?.(result)
  }
  return uploaded
}
