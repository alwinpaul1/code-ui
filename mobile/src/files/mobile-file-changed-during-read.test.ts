import { describe, expect, it, vi } from 'vitest'
import type { RpcResponse } from '../transport/types'
import { readMobileFileBase64Chunked } from './mobile-file-chunked-read'
import type { MobileFilePreviewRpcSender } from './mobile-file-preview-operations'
import { saveDesktopFileToPhone, type MobileFileSaveTarget } from './mobile-file-save'

// The host's files.readChunk (orca src/main/runtime/orca-runtime-files.ts readFileExplorerChunk at
// ac675ded6e, unchanged since it landed in b8d6b21dfa) stats the file on EVERY call:
//   buffer = Buffer.alloc(min(length, max(0, size - offset)))
//   { bytesRead } = handle.read(buffer, 0, buffer.byteLength, offset)
//   eof = offset + bytesRead >= size
// So on a file that does not change, the last chunk that carries bytes always says eof=true, and a
// chunk shorter than asked always says eof=true. Anything else means the file changed under the
// read. This fake answers exactly that way, against whatever the file is at the moment of each call.

function ok(result: unknown): RpcResponse {
  return { id: '1', ok: true, result, _meta: { runtimeId: 'runtime-1' } } as RpcResponse
}

function hostReadingLiveFile(current: () => Buffer, onCall?: (n: number) => void) {
  let calls = 0
  const sendRequest = vi.fn(async (method: string, params: Record<string, unknown>) => {
    if (method !== 'files.readChunk') {
      throw new Error(`unexpected ${method}`)
    }
    calls += 1
    onCall?.(calls)
    const file = current()
    const offset = params.offset as number
    const length = params.length as number
    const slice = file.subarray(
      offset,
      offset + Math.min(length, Math.max(0, file.length - offset))
    )
    return ok({
      contentBase64: slice.toString('base64'),
      bytesRead: slice.length,
      eof: offset + slice.length >= file.length
    })
  })
  return { sendRequest } as unknown as MobileFilePreviewRpcSender
}

function phone() {
  const written = new Map<string, string>()
  const target: MobileFileSaveTarget = {
    createDocument: vi.fn(async () => 'content://downloads/document/7'),
    writeBase64: vi.fn(async (uri: string, base64: string) => {
      written.set(uri, base64)
    }),
    remove: vi.fn(async () => {})
  }
  return { target, written }
}

const KB = 1024
const CHANGED =
  "Couldn't save run.log: the file changed on the desktop while it was being read; try again"

describe('a file that changes on the desktop while the phone pages it over', () => {
  it('does not report "saved" for a file that shrank between two waves of chunks', async () => {
    // A 1 MB log the desktop rewrites down to 300 KB while the save is on its second wave.
    const before = Buffer.alloc(1024 * KB, 0x61)
    const after = Buffer.alloc(300 * KB, 0x62)
    let file = before
    // Four chunks per wave (MOBILE_FILE_CHUNK_PARALLELISM); the 5th call is the second wave.
    const host = hostReadingLiveFile(
      () => file,
      (n) => {
        if (n === 5) {
          file = after
        }
      }
    )
    const { target } = phone()

    const outcome = await saveDesktopFileToPhone(
      host,
      { source: { source: 'worktree', worktreeId: 'wt-1', relativePath: 'logs/run.log' } },
      target
    )

    // What would have been written is neither file: 768 KB of the old one.
    expect(outcome).toEqual({ status: 'failed', fileName: 'run.log', message: CHANGED })
    expect(target.createDocument).not.toHaveBeenCalled()
  })

  it('does not report "saved" when a chunk comes back short without eof', async () => {
    // A chunk shorter than asked with eof=false: the host's own read came up short of the size it
    // had just stat'ed (the file was cut between its stat and its read). The rest was never read.
    const file = Buffer.alloc(900 * KB, 0x63)
    const sendRequest = vi.fn(async (_method: string, params: Record<string, unknown>) => {
      const offset = params.offset as number
      const length = params.length as number
      const short = offset === 192 * KB
      const slice = file.subarray(offset, offset + (short ? 1000 : length))
      return ok({
        contentBase64: slice.toString('base64'),
        bytesRead: slice.length,
        eof: short ? false : offset + slice.length >= file.length
      })
    })
    const host = { sendRequest } as unknown as MobileFilePreviewRpcSender
    const { target } = phone()

    const outcome = await saveDesktopFileToPhone(
      host,
      { source: { source: 'worktree', worktreeId: 'wt-1', relativePath: 'build/run.log' } },
      target
    )

    expect(outcome).toEqual({ status: 'failed', fileName: 'run.log', message: CHANGED })
    expect(target.createDocument).not.toHaveBeenCalled()
  })

  it('does not report "saved" for a file that grew past the end an earlier chunk reported', async () => {
    // Chunk 2 ends the file at 300 KB (short, eof); the desktop appends before chunk 3 is read, so
    // chunk 3 of the same wave carries bytes past that end.
    const before = Buffer.alloc(300 * KB, 0x61)
    const after = Buffer.alloc(700 * KB, 0x61)
    let file = before
    const host = hostReadingLiveFile(
      () => file,
      (n) => {
        if (n === 3) {
          file = after
        }
      }
    )
    const { target } = phone()

    const outcome = await saveDesktopFileToPhone(
      host,
      { source: { source: 'worktree', worktreeId: 'wt-1', relativePath: 'logs/run.log' } },
      target
    )

    expect(outcome).toEqual({ status: 'failed', fileName: 'run.log', message: CHANGED })
  })

  it('still saves a file that did not change, whatever its size lands on', async () => {
    for (const size of [0, 1, 192 * KB, 4 * 192 * KB, 4 * 192 * KB + 1, 1000 * KB]) {
      const bytes = Buffer.alloc(size, 0x5a)
      const { target, written } = phone()

      const outcome = await saveDesktopFileToPhone(
        hostReadingLiveFile(() => bytes),
        { source: { source: 'worktree', worktreeId: 'wt-1', relativePath: 'data.bin' } },
        target
      )

      expect(outcome, `size ${size}`).toEqual({
        status: 'saved',
        fileName: 'data.bin',
        byteLength: size
      })
      expect(Buffer.from(written.get('content://downloads/document/7') ?? '', 'base64')).toEqual(
        bytes
      )
    }
  })
})

describe('the PDF viewer reading a file that changes under it', () => {
  // The viewer shares the chunked read and caches what it returns for ten minutes
  // (mobile-pdf-cache.ts), so a spliced PDF would be the one it reopens. It refuses the same way.
  it('refuses a PDF that shrank mid-read instead of handing back two versions spliced', async () => {
    const before = Buffer.alloc(1024 * KB, 0x25)
    let file = before
    const host = hostReadingLiveFile(
      () => file,
      (n) => {
        if (n === 5) {
          file = Buffer.alloc(300 * KB, 0x25)
        }
      }
    )

    await expect(
      readMobileFileBase64Chunked(host, 'id:wt-1', 'out/paper.pdf')
    ).rejects.toThrow('the file changed on the desktop while it was being read; try again')
  })
})
