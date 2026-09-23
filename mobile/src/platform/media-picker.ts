import { readSystemClipboardImage } from '../session/mobile-clipboard-image-reader'
import { pickMobileImage, pickMobileImages } from '../session/mobile-image-source-picker'
import { resizeMobilePhoto } from '../session/mobile-photo-resize'
import type { MediaPicker } from './media-picker-contract'

/**
 * Picking media on a phone: the OS pickers, exactly as the session screen has always reached
 * them.
 *
 * This file is the seam's native half and holds no logic of its own. The web sibling is where the
 * work is — a page served from a custom scheme has no photo library and no Files app — and the
 * reason the seam exists at all is that `expo-image-picker` and `expo-document-picker` are native
 * modules whose import runs a codegen lookup that throws in a browser.
 *
 * The pasteboard is the clipboard seam's on both platforms, not this one's, except as the
 * composer's Paste image source (CODE UI, see the contract's `MobileImageSource`).
 */
const devicePicker: MediaPicker = {
  // CODE UI: each member keeps exactly the dependencies its one caller passed before the seam.
  // The terminal's attach picks from the library and sends the original bytes; the chat's attach
  // also reads the pasteboard and sends a photo at 2048 px (f7b86d08), which is why only the
  // multi-pick binds the clipboard reader and the resizer.
  pickImage: (source) => pickMobileImage(source),
  pickImages: (source) =>
    pickMobileImages(source, {
      readClipboardImage: readSystemClipboardImage,
      resizeImage: resizeMobilePhoto
    })
}

export function useMediaPicker(): MediaPicker {
  // No hook state: every member is a module function, so one frozen object serves every screen and
  // a caller may put it in a dependency list without re-running its effect on each render.
  return devicePicker
}
