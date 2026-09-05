import type { RpcClient } from '../transport/rpc-client'
import type { RpcFailure, RpcSuccess } from '../transport/types'

type ChunkedReadClient = Pick<RpcClient, 'sendRequest'>

/** Host cap on one `files.readChunk` is 512 KiB; this stays well under it (and under
 *  any relay frame budget) and is a
 *  multiple of 3, so each chunk's base64 concatenates without re-decoding. */
export const MOBILE_FILE_CHUNK_BYTES = 192 * 1024

/** Bigger than any paper or datasheet; keeps a stray multi-hundred-MB file
 *  from being pulled over the relay into a data URI. */
export const MOBILE_CHUNKED_READ_MAX_BYTES = 80 * 1024 * 1024

/** Reads in flight at once. The relay round trip, not bandwidth, dominates a
 *  chunk, so four in parallel cut a 3 MB PDF from ~16 serial trips to ~4 waves. */
export const MOBILE_FILE_CHUNK_PARALLELISM = 4

type Chunk = { contentBase64?: string; bytesRead?: number; eof?: boolean }

/**
 * Read a worktree file as base64 via `files.readChunk` until EOF.
 *
 * Why: `files.readPreview` is capped on the host and refuses ordinary PDFs with
 * `file_too_large`. `readChunk` has no whole-file cap, only a per-call one, so the
 * viewer pages the bytes over instead. No `files.stat` first: the host's mobile
 * allowlist has `readChunk` but not `stat`, so the size is learned from `eof`.
 * Chunks are requested a few at a time and stitched in offset order.
 */
export async function readMobileFileBase64Chunked(
  client: ChunkedReadClient,
  worktree: string,
  relativePath: string,
  options: {
    maxBytes?: number
    chunkBytes?: number
    parallelism?: number
    onProgress?: (bytesSoFar: number) => void
  } = {}
): Promise<{ base64: string; byteLength: number }> {
  const maxBytes = options.maxBytes ?? MOBILE_CHUNKED_READ_MAX_BYTES
  const chunkBytes = options.chunkBytes ?? MOBILE_FILE_CHUNK_BYTES
  const parallelism = Math.max(1, options.parallelism ?? MOBILE_FILE_CHUNK_PARALLELISM)

  const readAt = async (offset: number): Promise<Chunk> => {
    const response = await client.sendRequest('files.readChunk', {
      worktree,
      relativePath,
      offset,
      length: chunkBytes
    })
    if (!response.ok) {
      throw new Error((response as RpcFailure).error.message)
    }
    const chunk = (response as RpcSuccess).result as Chunk
    if (typeof chunk.contentBase64 !== 'string') {
      throw new Error('binary_file')
    }
    return chunk
  }

  const parts: string[] = []
  let total = 0
  let nextOffset = 0
  let ended = false
  // A wave is `parallelism` consecutive chunks; a short or eof chunk ends the read.
  while (!ended) {
    const offsets: number[] = []
    for (let i = 0; i < parallelism; i++) {
      offsets.push(nextOffset)
      nextOffset += chunkBytes
    }
    const chunks = await Promise.all(offsets.map(readAt))
    for (const chunk of chunks) {
      const bytesRead = chunk.bytesRead ?? 0
      if (bytesRead > 0) {
        parts.push(chunk.contentBase64 as string)
        total += bytesRead
        options.onProgress?.(total)
      }
      if (total > maxBytes) {
        throw new Error('file_too_large')
      }
      if (chunk.eof || bytesRead < chunkBytes) {
        ended = true
        break
      }
    }
  }
  if (total === 0) {
    throw new Error('binary_file')
  }
  return { base64: parts.join(''), byteLength: total }
}
