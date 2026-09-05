import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearMobilePdfCacheForTests, resolveMobilePdfUri } from './mobile-pdf-cache'

vi.mock('expo-file-system', () => ({ File: class {}, Paths: { cache: 'file:///cache' } }))

function ok(result: unknown) {
  return { id: 'r', ok: true as const, result, _meta: { runtimeId: 'rt' } }
}
function server(bytes: Buffer) {
  return vi.fn(async (_m: string, p: Record<string, number>) => {
    const slice = bytes.subarray(p.offset, p.offset + p.length)
    return ok({
      contentBase64: slice.toString('base64'),
      bytesRead: slice.length,
      eof: p.offset + slice.length >= bytes.length
    })
  })
}
function fakeFs() {
  const files = new Map<string, string>()
  return {
    files,
    fs: {
      writeBase64: (name: string, base64: string) => {
        files.set(`file:///cache/${name}`, base64)
        return `file:///cache/${name}`
      },
      exists: (uri: string) => files.has(uri)
    }
  }
}

describe('resolveMobilePdfUri', () => {
  afterEach(() => clearMobilePdfCacheForTests())

  it('writes the PDF to the cache once and serves the reopen from it', async () => {
    const bytes = Buffer.from('%PDF-1.7 hello')
    const sendRequest = server(bytes)
    const { fs, files } = fakeFs()
    let now = 1_000
    const first = await resolveMobilePdfUri({ sendRequest }, 'id:w', 'a.pdf', { fs, now: () => now })
    expect(first.fromCache).toBe(false)
    expect(first.uri.startsWith('file:///cache/orca-pdf-')).toBe(true)
    expect(Buffer.from(files.get(first.uri)!, 'base64').toString()).toBe('%PDF-1.7 hello')
    const calls = sendRequest.mock.calls.length
    now += 60_000
    const second = await resolveMobilePdfUri({ sendRequest }, 'id:w', 'a.pdf', { fs, now: () => now })
    expect(second).toEqual({ ...first, fromCache: true })
    expect(sendRequest.mock.calls.length).toBe(calls)
  })

  it('refetches after the TTL or when the cached file is gone', async () => {
    const sendRequest = server(Buffer.from('%PDF x'))
    const { fs, files } = fakeFs()
    let now = 0
    const first = await resolveMobilePdfUri({ sendRequest }, 'id:w', 'b.pdf', { fs, now: () => now, ttlMs: 100 })
    now = 200
    const second = await resolveMobilePdfUri({ sendRequest }, 'id:w', 'b.pdf', { fs, now: () => now, ttlMs: 100 })
    expect(second.fromCache).toBe(false)
    files.clear()
    const third = await resolveMobilePdfUri({ sendRequest }, 'id:w', 'b.pdf', { fs, now: () => now, ttlMs: 100 })
    expect(third.fromCache).toBe(false)
    expect(first.uri).toBe(third.uri)
  })

  it('joins a concurrent open of the same PDF onto one read', async () => {
    const sendRequest = server(Buffer.alloc(10, 7))
    const { fs } = fakeFs()
    const [a, b] = await Promise.all([
      resolveMobilePdfUri({ sendRequest }, 'id:w', 'c.pdf', { fs }),
      resolveMobilePdfUri({ sendRequest }, 'id:w', 'c.pdf', { fs })
    ])
    expect(a.uri).toBe(b.uri)
    expect(sendRequest).toHaveBeenCalledTimes(4)
  })

  it('falls back to a data URI when the cache cannot be written', async () => {
    const sendRequest = server(Buffer.from('%PDF y'))
    const fs = {
      writeBase64: () => {
        throw new Error('ENOSPC')
      },
      exists: () => false
    }
    const result = await resolveMobilePdfUri({ sendRequest }, 'id:w', 'd.pdf', { fs })
    expect(result.uri.startsWith('data:application/pdf;base64,')).toBe(true)
  })
})
