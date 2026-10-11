import { FileMode, File as FsFile, Paths } from 'expo-file-system'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import {
  markupSourceTraits,
  markupSourceTraitsFromDataUri,
  type MarkupOutputFormat,
  type MarkupSourceTraits
} from '../session/image-markup-format'
import type { ImageMarkupResult } from '../session/image-markup-store'

// The device half of the markup editor's output (the decision itself is
// image-markup-format.ts): reading the source picture's first bytes, and
// writing the flattened picture as a JPEG when the source was opaque.

const UNKNOWN: MarkupSourceTraits = { mimeType: null, hasAlpha: null }

/** Bytes enough for a PNG's chunks before its pixels (image-markup-format.ts). */
const SOURCE_HEAD_BYTES = 96 * 1024

export type ReadFileHead = (uri: string, length: number) => Uint8Array

function readFileHead(uri: string, length: number): Uint8Array {
  // Read-only: a mode-less open of a file:// path is read-write in
  // expo-file-system 57, which creates a missing file and fails on one the
  // app cannot write (Opus review).
  const handle = new FsFile(uri).open(FileMode.ReadOnly)
  try {
    return handle.readBytes(length)
  } finally {
    handle.close()
  }
}

/** What the picture being marked up is: from a `data:` URL's own bytes, or
 *  from the first bytes of a local file. Unknown for anything else, and for a
 *  file that cannot be read, which keeps the output PNG. */
export function loadMarkupSourceTraits(uri: string, readHead: ReadFileHead = readFileHead): MarkupSourceTraits {
  if (/^data:/i.test(uri)) {
    return markupSourceTraitsFromDataUri(uri)
  }
  if (!/^(file|content):/i.test(uri)) {
    return UNKNOWN
  }
  try {
    return markupSourceTraits(readHead(uri, SOURCE_HEAD_BYTES))
  } catch (error) {
    console.warn(`[markup] could not read the picture's header (${describe(error)}); it will be saved as PNG`)
    return UNKNOWN
  }
}

/** Re-encodes the flattened PNG as a JPEG at `quality` (0..1) and returns its
 *  base64. Through a cache file, as the clipboard resize does: the
 *  manipulator's loader is not trusted with a large `data:` URL. */
export type MarkupJpegEncoder = (pngBase64: string, quality: number) => Promise<string>

const encodePngAsJpeg: MarkupJpegEncoder = async (pngBase64, quality) => {
  const file = new FsFile(Paths.cache, `orca-markup-${Date.now()}.png`)
  let context: ReturnType<typeof ImageManipulator.manipulate> | null = null
  let rendered: Awaited<ReturnType<ReturnType<typeof ImageManipulator.manipulate>['renderAsync']>> | null = null
  let savedUri: string | null = null
  try {
    file.create({ overwrite: true })
    file.write(pngBase64, { encoding: 'base64' })
    context = ImageManipulator.manipulate(file.uri)
    rendered = await context.renderAsync()
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: quality, base64: true })
    savedUri = saved.uri
    return saved.base64 ?? ''
  } finally {
    rendered?.release()
    context?.release()
    for (const uri of [savedUri, file.uri]) {
      try {
        if (uri) {
          new FsFile(uri).delete()
        }
      } catch {
        // Best effort: the OS reclaims the cache directory regardless.
      }
    }
  }
}

/** The editor's Done result in the chosen format. The flatten is always a
 *  PNG (react-native-svg's toDataURL); an opaque source's is re-encoded as a
 *  JPEG at 85, the Claude app's choice. If that fails the PNG still holds the
 *  marks, so it goes out instead and the log says why. */
export async function encodeMarkupOutput(
  pngBase64: string,
  format: MarkupOutputFormat,
  toJpeg: MarkupJpegEncoder = encodePngAsJpeg
): Promise<ImageMarkupResult> {
  switch (format.format) {
    case 'png':
      return { base64: pngBase64, mimeType: 'image/png' }
    case 'jpeg':
      try {
        const jpeg = await toJpeg(pngBase64, format.quality / 100)
        if (jpeg) {
          return { base64: jpeg, mimeType: 'image/jpeg' }
        }
        console.warn('[markup] the JPEG encoder returned no bytes; the marked-up picture is saved as PNG')
      } catch (error) {
        console.warn(`[markup] could not write the marked-up picture as JPEG (${describe(error)}); it is saved as PNG`)
      }
      return { base64: pngBase64, mimeType: 'image/png' }
    default: {
      const unhandled: never = format
      return unhandled
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
