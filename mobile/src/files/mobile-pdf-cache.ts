import { File as FsFile, Paths } from 'expo-file-system'
import type { RpcClient } from '../transport/rpc-client'
import { readMobileFileBase64Chunked } from './mobile-file-chunked-read'

/** A reopen inside this window is served from the phone's cache without a
 *  round trip. Long enough for flipping between tabs, short enough that a PDF
 *  the agent just rewrote shows up on the next visit. */
export const MOBILE_PDF_CACHE_TTL_MS = 10 * 60_000

export type MobilePdfCacheFs = {
  writeBase64: (name: string, base64: string) => string
  exists: (uri: string) => boolean
}

type Entry = { uri: string; byteLength: number; at: number }
const index = new Map<string, Entry>()
const inFlight = new Map<string, Promise<{ uri: string; byteLength: number }>>()

function keyOf(worktree: string, relativePath: string): string {
  return `${worktree}\n${relativePath}`
}

function fileNameFor(key: string): string {
  let hash = 5381
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash + key.charCodeAt(i)) | 0
  }
  return `orca-pdf-${(hash >>> 0).toString(16)}.pdf`
}

const defaultFs: MobilePdfCacheFs = {
  writeBase64: (name, base64) => {
    const file = new FsFile(Paths.cache, name)
    file.create({ overwrite: true })
    file.write(base64, { encoding: 'base64' })
    return file.uri
  },
  exists: (uri) => {
    try {
      return new FsFile(uri).exists
    } catch {
      return false
    }
  }
}

/**
 * Resolve a worktree PDF to a URI the native viewer can open.
 *
 * Why a file: the bytes arrive as base64 over the relay, and handing a 20 MB
 * data: URI across the bridge on every open is what made the viewer feel slow.
 * The base64 is written once to the app cache and the viewer gets a file URI;
 * the same open within the TTL costs nothing. A concurrent open of the same
 * PDF joins the in-flight read instead of fetching twice.
 */
export async function resolveMobilePdfUri(
  client: Pick<RpcClient, 'sendRequest'>,
  worktree: string,
  relativePath: string,
  options: {
    onProgress?: (bytesSoFar: number) => void
    fs?: MobilePdfCacheFs
    now?: () => number
    ttlMs?: number
  } = {}
): Promise<{ uri: string; byteLength: number; fromCache: boolean }> {
  const fs = options.fs ?? defaultFs
  const now = options.now ?? Date.now
  const ttl = options.ttlMs ?? MOBILE_PDF_CACHE_TTL_MS
  const key = keyOf(worktree, relativePath)
  const cached = index.get(key)
  if (cached && now() - cached.at < ttl && fs.exists(cached.uri)) {
    return { uri: cached.uri, byteLength: cached.byteLength, fromCache: true }
  }
  index.delete(key)
  let pending = inFlight.get(key)
  if (!pending) {
    pending = (async () => {
      const { base64, byteLength } = await readMobileFileBase64Chunked(
        client,
        worktree,
        relativePath,
        { onProgress: options.onProgress }
      )
      let uri: string
      try {
        uri = fs.writeBase64(fileNameFor(key), base64)
        index.set(key, { uri, byteLength, at: now() })
      } catch {
        // No cache dir (or no space): the viewer still opens from memory.
        uri = `data:application/pdf;base64,${base64}`
      }
      return { uri, byteLength }
    })()
    inFlight.set(key, pending)
    void pending.finally(() => inFlight.delete(key))
  }
  return { ...(await pending), fromCache: false }
}

/** Test hook: forget every cached PDF. */
export function clearMobilePdfCacheForTests(): void {
  index.clear()
  inFlight.clear()
}
