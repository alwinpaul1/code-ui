import { File as FsFile } from 'expo-file-system'
import {
  CLIPBOARD_IMAGE_MAX_SOURCE_BYTES,
  assertClipboardImageBase64LengthWithinLimit,
  assertClipboardImageByteLengthWithinLimit
} from '../../../src/shared/clipboard-image'
import { MobileImageBase64Accumulator } from './mobile-image-base64-accumulator'

// Reading a picked file into the base64 the host upload takes. Split from the picker
// (mobile-image-source-picker.ts) for its line ceiling.

const MOBILE_IMAGE_READ_CHUNK_BYTES = 256 * 1024

type MobileImageFileHandle = {
  readonly size: number | null
  readBytes(length: number): Uint8Array
  close(): void
}

export type MobileImageFile = {
  readonly size: number
  open(): MobileImageFileHandle
  delete(): void
  /** expo-file-system's native read and encode, off the JS thread. */
  base64?(): Promise<string>
}

export type MobileImageFileFactory = (uri: string) => MobileImageFile

export function defaultMobileImageFileFactory(uri: string): MobileImageFile {
  return new FsFile(uri)
}

/** Any picked file, read in chunks with a running size check, so a file that grows past the
 *  cap mid-read is refused after one chunk past it rather than read whole. */
export async function readUriAsBase64(
  uri: string,
  declaredSize: number | undefined,
  createFile: MobileImageFileFactory
): Promise<string> {
  if (typeof declaredSize === 'number' && Number.isFinite(declaredSize)) {
    assertClipboardImageByteLengthWithinLimit(declaredSize)
  }

  const file = createFile(uri)
  assertClipboardImageByteLengthWithinLimit(file.size)
  const handle = file.open()
  try {
    if (handle.size !== null) {
      assertClipboardImageByteLengthWithinLimit(handle.size)
    }
    const accumulator = new MobileImageBase64Accumulator()
    let bytesRead = 0
    while (bytesRead <= CLIPBOARD_IMAGE_MAX_SOURCE_BYTES) {
      const requested = Math.min(
        MOBILE_IMAGE_READ_CHUNK_BYTES,
        CLIPBOARD_IMAGE_MAX_SOURCE_BYTES - bytesRead + 1
      )
      const bytes = handle.readBytes(requested)
      if (bytes.byteLength === 0) {
        break
      }
      bytesRead += bytes.byteLength
      assertClipboardImageByteLengthWithinLimit(bytesRead)
      accumulator.append(bytes)
    }
    const base64 = accumulator.finish()
    assertClipboardImageBase64LengthWithinLimit(base64.length)
    return base64
  } finally {
    handle.close()
  }
}

/**
 * A picked photo's bytes as base64, read and encoded by the file system natively. Why: the
 * chunked read above runs `readBytes` and the JS base64 accumulator on the JS thread, so a
 * photo's read stalled the composer while its chip waited (2026-10-11). The picker's photos
 * and the resizer's output are plain cache files, which `File.base64()` (an expo AsyncFunction)
 * reads off the JS thread. The size checks stay: the file's own size before the read, the
 * encoded length after it. A file object without a native read (a test double) takes the
 * chunked read.
 */
export async function readPhotoAsBase64(
  uri: string,
  declaredSize: number | undefined,
  createFile: MobileImageFileFactory
): Promise<string> {
  if (typeof declaredSize === 'number' && Number.isFinite(declaredSize)) {
    assertClipboardImageByteLengthWithinLimit(declaredSize)
  }
  const file = createFile(uri)
  if (typeof file.base64 !== 'function') {
    return readUriAsBase64(uri, declaredSize, createFile)
  }
  assertClipboardImageByteLengthWithinLimit(file.size)
  const base64 = await file.base64()
  assertClipboardImageBase64LengthWithinLimit(base64.length)
  return base64
}
