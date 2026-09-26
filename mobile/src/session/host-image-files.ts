import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'
import { hostImageFileStore } from './host-image-file-store'

/**
 * A picture the host sent, kept as a file in the app's cache directory.
 *
 * It arrives as base64, and a `data:` string of a phone screenshot is a
 * megabyte or more. Held as one, every picture an agent read in a long session
 * stayed in memory for the whole run. Written out once, what is held is the
 * file's URI, and Android's image pipeline decodes a local file down to the
 * size it is drawn at (React Native's `resizeMethod="auto"` resizes `file:`
 * URIs, never `data:` ones).
 *
 * Fail-open: with no file system (the web shell, the test runner) or a write
 * that fails, the picture stays the `data:` URI it came as, and a failed write
 * says why once.
 */
export type HostImageFileStore = {
  /** Writes the bytes to a file of that name in the cache; its URI. */
  write: (name: string, base64: string) => string
  exists: (uri: string) => boolean
}

const DATA_URI = /^data:image\/([a-z0-9.+-]+);base64,/i
let warned = false
/** Which picture (host and path) each file was last written for. */
const keyByUri = new Map<string, string>()

/** The name of a picture's file: SHA-256 of host and path, and the key's
 *  length. It was a 32-bit djb2 of the same, written with overwrite, so two
 *  paths that hashed alike shared one file and the first picture showed the
 *  second's bytes (review of 2026-09-26). A path itself can be longer than a
 *  file name may be. */
function fileNameFor(key: string, subtype: string): string {
  const hash = bytesToHex(sha256(new TextEncoder().encode(key)))
  const extension = subtype.toLowerCase() === 'svg+xml' ? 'svg' : subtype.toLowerCase().replace(/[^a-z0-9]/g, '')
  return `codeui-host-image-${hash}-${key.length}.${extension || 'img'}`
}

/** The URI to hold for a picture read at `key` (host and path). */
export function keepHostImageFile(
  key: string,
  dataUri: string,
  store: HostImageFileStore | null = hostImageFileStore
): string {
  const head = DATA_URI.exec(dataUri)
  if (!store || !head) {
    return dataUri
  }
  try {
    const uri = store.write(fileNameFor(key, head[1] ?? ''), dataUri.slice(head[0].length))
    keyByUri.set(uri, key)
    return uri
  } catch (error) {
    if (!warned) {
      warned = true
      console.warn(
        `[host-image] kept a picture in memory, its cache file could not be written: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    return dataUri
  }
}

/** False once a held file has gone (the system clears the cache directory),
 *  or was last written for another picture than `key`; a `data:` URI never
 *  goes. */
export function hostImageStillThere(
  uri: string,
  store: HostImageFileStore | null = hostImageFileStore,
  key?: string
): boolean {
  if (!store || !uri.startsWith('file:')) {
    return true
  }
  return store.exists(uri) && (key === undefined || keyByUri.get(uri) === key)
}

export function resetHostImageFilesForTests(): void {
  warned = false
  keyByUri.clear()
}
