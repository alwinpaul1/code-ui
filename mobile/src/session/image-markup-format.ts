/** Which format the markup editor's Done writes, copied from the Claude app
 *  (com.anthropic.claude 1.261009.20, decompiled 2026-10-11): `q130.r` keeps
 *  PNG at quality 100 only for a source bitmap that has alpha and is not a
 *  JPEG; everything else goes out as JPEG at quality 85 (`fl.z`,
 *  "ImageMarkupCompositor"). Android's `Bitmap.hasAlpha()` is false for a
 *  JPEG, for an RGB or grey PNG with no tRNS chunk, and for a WebP that does
 *  not flag alpha, so those are what is read here as opaque.
 *
 *  Pure and free of React Native: the editor reads the source's first bytes
 *  and hands them in (markup-image-output.ts). */

export type MarkupSourceTraits = {
  /** What the bytes are, read from their signature; null when unknown. */
  readonly mimeType: string | null
  /** Whether the picture can hold transparency; null when it could not be
   *  told (an unknown format, or bytes cut before the answer). */
  readonly hasAlpha: boolean | null
}

export type MarkupOutputFormat =
  | { readonly format: 'png'; readonly quality: 100; readonly mimeType: 'image/png' }
  | { readonly format: 'jpeg'; readonly quality: 85; readonly mimeType: 'image/jpeg' }

const PNG_OUTPUT: MarkupOutputFormat = { format: 'png', quality: 100, mimeType: 'image/png' }
const JPEG_OUTPUT: MarkupOutputFormat = { format: 'jpeg', quality: 85, mimeType: 'image/jpeg' }
const UNKNOWN: MarkupSourceTraits = { mimeType: null, hasAlpha: null }

/** JPEG at 85 for an opaque source, PNG at 100 otherwise. A source that could
 *  not be read stays PNG: lossless keeps every pixel and any transparency,
 *  where a JPEG chosen wrongly would lose both. A JPEG is opaque by format. */
export function markupOutputFormat(source: MarkupSourceTraits): MarkupOutputFormat {
  if (source.mimeType === 'image/jpeg' || source.hasAlpha === false) {
    return JPEG_OUTPUT
  }
  return PNG_OUTPUT
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function startsWith(bytes: Uint8Array, prefix: readonly number[], at = 0): boolean {
  return bytes.length >= at + prefix.length && prefix.every((byte, index) => bytes[at + index] === byte)
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(at, at + length))
}

/** A PNG has alpha when its colour type carries it (4 grey+alpha, 6 RGBA) or
 *  a tRNS chunk comes before the first IDAT. Reaching IDAT without one is
 *  opaque; bytes that end first say nothing. */
function pngHasAlpha(bytes: Uint8Array): boolean | null {
  if (bytes.length < 26) {
    return null
  }
  const colourType = bytes[25]
  if (colourType === 4 || colourType === 6) {
    return true
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = 8
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at)
    const type = ascii(bytes, at + 4, 4)
    if (type === 'tRNS') {
      return true
    }
    if (type === 'IDAT' || type === 'IEND') {
      return false
    }
    at += 12 + length
  }
  return null
}

/** A WebP's alpha: a lossy `VP8 ` has none, a lossless `VP8L` says so in its
 *  header's alpha bit, an extended `VP8X` in its flags. */
function webpHasAlpha(bytes: Uint8Array): boolean | null {
  const chunk = ascii(bytes, 12, 4)
  if (chunk === 'VP8 ') {
    return false
  }
  if (chunk === 'VP8L' && bytes.length > 24) {
    return ((bytes[24]! >> 4) & 1) === 1
  }
  if (chunk === 'VP8X' && bytes.length > 20) {
    return (bytes[20]! & 0x10) !== 0
  }
  return null
}

/** What a picture's first bytes say about it. */
export function markupSourceTraits(bytes: Uint8Array): MarkupSourceTraits {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { mimeType: 'image/jpeg', hasAlpha: false }
  }
  if (startsWith(bytes, PNG_SIGNATURE)) {
    return { mimeType: 'image/png', hasAlpha: pngHasAlpha(bytes) }
  }
  if (bytes.length >= 16 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return { mimeType: 'image/webp', hasAlpha: webpHasAlpha(bytes) }
  }
  return UNKNOWN
}

/** Enough base64 for the answer: a PNG's ancillary chunks before IDAT (an
 *  embedded colour profile or EXIF) can run to tens of KB. */
export const MARKUP_HEADER_BASE64_CHARS = 128 * 1024

const DATA_URL = /^data:[^,]*;base64,/i

/** The leading bytes of a base64 string, or null when it is not base64. */
export function base64HeadBytes(base64: string, maxChars = MARKUP_HEADER_BASE64_CHARS): Uint8Array | null {
  // Cut first, then strip whitespace: the whole data URL can be megabytes,
  // and this runs on every Done. Twice the window leaves room for line breaks.
  const clean = base64.slice(0, maxChars * 2).replace(/\s+/g, '').slice(0, maxChars)
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

/** The traits of the picture inside a `data:` URL, read from its bytes, not
 *  its label (Code UI labels every pasted picture `image/png`). Unknown for
 *  anything else. */
export function markupSourceTraitsFromDataUri(uri: string): MarkupSourceTraits {
  const prefix = DATA_URL.exec(uri)
  if (!prefix) {
    return UNKNOWN
  }
  const bytes = base64HeadBytes(uri.slice(prefix[0].length))
  return bytes ? markupSourceTraits(bytes) : UNKNOWN
}
