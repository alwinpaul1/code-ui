import { describe, expect, it, vi } from 'vitest'
import { readMobileFileBase64Chunked } from './mobile-file-chunked-read'

function ok(result: unknown) {
  return { id: 'r', ok: true as const, result, _meta: { runtimeId: 'rt' } }
}

function chunkServer(bytes: Buffer) {
  return vi.fn(async (method: string, params: Record<string, number>) => {
    expect(method).toBe('files.readChunk')
    const slice = bytes.subarray(params.offset, params.offset + params.length)
    return ok({
      contentBase64: slice.toString('base64'),
      bytesRead: slice.length,
      eof: params.offset + slice.length >= bytes.length
    })
  })
}

describe('readMobileFileBase64Chunked', () => {
  it('pages the file until eof; chunk base64 concatenates cleanly (no files.stat)', async () => {
    const bytes = Buffer.from('a'.repeat(10))
    const sendRequest = chunkServer(bytes)
    const result = await readMobileFileBase64Chunked({ sendRequest } as never, 'id:w', 'doc.pdf', {
      chunkBytes: 6
    })
    expect(result.byteLength).toBe(10)
    expect(Buffer.from(result.base64, 'base64').toString()).toBe('a'.repeat(10))
    // One wave of four requests covers the file; a short chunk ends the read.
    expect(sendRequest).toHaveBeenCalledTimes(4)
  })

  it('stitches parallel waves in offset order and reports progress', async () => {
    const bytes = Buffer.from(Array.from({ length: 30 }, (_, i) => 65 + (i % 26)))
    const sendRequest = chunkServer(bytes)
    const progress: number[] = []
    const result = await readMobileFileBase64Chunked({ sendRequest } as never, 'id:w', 'doc.pdf', {
      chunkBytes: 3,
      parallelism: 4,
      onProgress: (n) => progress.push(n)
    })
    expect(Buffer.from(result.base64, 'base64').equals(bytes)).toBe(true)
    expect(progress.at(-1)).toBe(30)
    expect(sendRequest).toHaveBeenCalledTimes(12)
  })

  it('stops with file_too_large once the running total passes the cap', async () => {
    const sendRequest = chunkServer(Buffer.alloc(100, 1))
    await expect(
      readMobileFileBase64Chunked({ sendRequest } as never, 'id:w', 'big.pdf', {
        maxBytes: 50,
        chunkBytes: 30
      })
    ).rejects.toThrow('file_too_large')
  })

  it('treats an empty file as unreadable', async () => {
    const sendRequest = chunkServer(Buffer.alloc(0))
    await expect(
      readMobileFileBase64Chunked({ sendRequest } as never, 'id:w', 'empty.pdf')
    ).rejects.toThrow('binary_file')
  })
})
