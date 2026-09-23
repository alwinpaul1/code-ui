/**
 * What picking media means to the screens, free of any device API.
 *
 * The two siblings of `media-picker.ts` agree on this and nothing else: one opens the OS pickers
 * over `expo-image-picker` and `expo-document-picker`, the other asks the shell for them over
 * `native.media.pick` / `read` / `release`. Neither type nor error may live beside an Expo import,
 * because a screen that catches `ImageLibraryPermissionError` would otherwise drag the native
 * picker chain into the page bundle for the sake of one `instanceof`.
 *
 * The pasteboard is not here: `platform/clipboard.ts` owns it on both platforms, and on the web
 * its `readImage` reaches the same `native.media.pick` with `source: 'clipboard'`.
 */

/**
 * Where a picked image comes from.
 *
 * CODE UI: four sources, not upstream's two. This fork's composer takes a photo with the camera
 * and attaches the pasteboard's image from the same Add-context sheet as the library and Files, so
 * all four go through the one seam. On the web the shell's `native.media.pick` serves three of
 * them; it has no camera, and `media-picker.web.ts` refuses that one rather than answering empty.
 */
export type MobileImageSource = 'camera' | 'library' | 'files' | 'clipboard'

export type PickedMobileImage = {
  // Raw base64 (no data: prefix); fed straight into the existing upload pipeline.
  // Empty when the bytes come on demand through `load`: a photo from the
  // camera or the library is handed over as soon as the picker names it, so
  // the composer chip shows at once, and its file is read only then — a
  // 12-megapixel JPEG streamed into base64 on the JS thread took seconds
  // before the chip appeared (device, 2026-09-20).
  readonly base64: string
  readonly load?: () => Promise<string>
  // Local file URI of the picked asset — used only to render a composer preview
  // thumbnail (the host upload uses `base64`); absent when the source can't supply one.
  readonly uri?: string
  // Set for documents picked through `pickMobileDocuments`: the chip shows the
  // name, and the sent message tells the agent what the upload actually is.
  readonly name?: string
  readonly mimeType?: string
}

export class ImageLibraryPermissionError extends Error {
  constructor() {
    super('Photo library permission denied')
    this.name = 'ImageLibraryPermissionError'
  }
}

/**
 * Picking on whichever half of the app is running.
 *
 * A hook rather than three functions because the web sibling needs the page's bridge client, which
 * is React context — the shape the clipboard seam already has.
 *
 * Rejecting is how every one of these reports failure, and a cancelled picker is not a failure: it
 * answers `null` or an empty sequence. The web sibling never turns a refusal into one of those,
 * because "the shell refused the pick" and "the user changed their mind" lead a caller to opposite
 * screens.
 */
export type MediaPicker = {
  pickImage: (source: MobileImageSource) => Promise<PickedMobileImage | null>
  pickImages: (source: MobileImageSource) => AsyncIterable<PickedMobileImage>
}
