import { Image } from 'react-native'

// The markup editor needs a photo's size before it can lay out the canvas.
// Image.getSize fetches the encoded image on Android, through Fresco, which
// refuses a `data:` source there ("Unsupported uri scheme for encoded image
// fetch"). A marked-up photo's preview is a `data:` URL
// (markedUpNativeChatImagePreviewUri), and so is a pasted screenshot's, so
// opening one in the editor again drew "Couldn't load image" (2026-09-26). A
// `data:` photo is sized from its own header instead.

type Size = { width: number; height: number }
type GetSize = (uri: string, ok: (width: number, height: number) => void, fail: () => void) => void

/** Enough base64 for the headers read here: a PNG's IHDR is in its first 24
 *  bytes, and a JPEG's frame header follows its APP segments (EXIF can run
 *  to 64 KB). */
const HEADER_BASE64_CHARS = 96 * 1024

function bytesOf(base64: string): Uint8Array | null {
  const clean = base64.replace(/\s+/g, '').slice(0, HEADER_BASE64_CHARS)
  const whole = clean.slice(0, clean.length - (clean.length % 4))
  try {
    const binary = atob(whole)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return bytes
  } catch {
    return null
  }
}

function pngSize(bytes: Uint8Array): Size | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 24 || signature.some((byte, index) => bytes[index] !== byte)) {
    return null
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

/** A JPEG's size from its first start-of-frame segment (SOF0–SOF15 except
 *  DHT, JPG and DAC). */
function jpegSize(bytes: Uint8Array): Size | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null
  }
  let at = 2
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) {
      return null
    }
    const marker = bytes[at + 1]!
    const length = (bytes[at + 2]! << 8) | bytes[at + 3]!
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[at + 5]! << 8) | bytes[at + 6]!, width: (bytes[at + 7]! << 8) | bytes[at + 8]! }
    }
    at += 2 + length
  }
  return null
}

/** A `data:` URL's image size from its header, or null for any other URL, or
 *  one whose header gives no size. */
export function imageSizeFromDataUri(uri: string): Size | null {
  const match = /^data:[^,]*;base64,/i.exec(uri)
  if (!match) {
    return null
  }
  const bytes = bytesOf(uri.slice(match[0].length))
  const size = bytes ? (pngSize(bytes) ?? jpegSize(bytes)) : null
  return size && size.width > 0 && size.height > 0 ? size : null
}

/** The photo's size for the markup editor: from a `data:` URL's header, and
 *  from Image.getSize for any other. */
export function loadMarkupImageSize(
  uri: string,
  onSize: (width: number, height: number) => void,
  onFail: () => void,
  getSize: GetSize = (source, ok, fail) => Image.getSize(source, ok, fail)
): void {
  if (/^data:/i.test(uri)) {
    const size = imageSizeFromDataUri(uri)
    if (size) {
      onSize(size.width, size.height)
    } else {
      onFail()
    }
    return
  }
  getSize(uri, onSize, onFail)
}
