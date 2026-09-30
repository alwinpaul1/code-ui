import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('expo-file-system', () => ({ File: class {}, Paths: { cache: 'file:///cache' } }))
vi.mock('./mobile-pdf-cache', () => ({ resolveMobilePdfUri: vi.fn() }))

import { createMarkdownImageResolver } from './markdown-image-resolver'

/**
 * Review 2026-09-30 (round 3): a figure the desktop refused for a reason about its runtime, not the
 * file, stayed a link for as long as the document was open. The resolver dropped a failed read only
 * for four phrases ("remote connection dropped" and the like); the desktop's own recoverable
 * refusals ("Remote Orca runtime is not connected.", "Request timed out") fell through to the
 * generic "Unable to load preview: ..." and were cached as if the file had answered.
 */

type Reply = { throw: string } | { ok: boolean; result?: unknown; error?: unknown }

/** A live client double: reads answer from a script, in order, and `connect` is a NEW connection. */
function liveHost(replies: Reply[]) {
  let connectedAt: number | null = 1
  const listeners = new Set<() => void>()
  const calls: string[] = []
  const client = {
    sendRequest: vi.fn(async (method: string) => {
      calls.push(method)
      const next = replies.shift()
      if (!next) {
        throw new Error('no reply scripted')
      }
      if ('throw' in next) {
        throw new Error(next.throw)
      }
      return next
    }),
    getLastConnectedAt: () => connectedAt,
    onStateChange: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
  return {
    calls,
    resolve: createMarkdownImageResolver({
      client: client as never,
      worktreeId: 'wt',
      documentRelativePath: 'README.md'
    }),
    connect: (at: number) => {
      connectedAt = at
      for (const listener of Array.from(listeners)) {
        listener()
      }
    }
  }
}

const PNG = { isBinary: true, isImage: true, mimeType: 'image/png', content: 'AAAA' }
const BITMAP = { kind: 'bitmap', uri: 'data:image/png;base64,AAAA' }

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('a figure the desktop refused for a reason about its runtime, not the file', () => {
  it.each([
    ['the remote runtime was not connected', 'runtime_unavailable', 'Remote Orca runtime is not connected.'],
    ['the request timed out', 'timeout', 'Request timed out'],
    [
      'the remote runtime closed the connection',
      'remote_runtime_unavailable',
      'Remote Orca runtime closed the connection'
    ],
    ['the cause is one this build does not know', 'internal', 'Something new went wrong on the desktop']
  ])('is drawn after a new connection when %s', async (_why, code, message) => {
    const host = liveHost([{ ok: false, error: { code, message } }, { ok: true, result: PNG }])
    await expect(host.resolve('p.png')).resolves.toBeNull()
    host.connect(2)
    await expect(host.resolve('p.png')).resolves.toEqual(BITMAP)
    expect(host.calls).toHaveLength(2)
  })

  it('is drawn after a new connection when the request itself was rejected', async () => {
    const host = liveHost([{ throw: 'Request timed out: files.readPreview' }, { ok: true, result: PNG }])
    await expect(host.resolve('p.png')).resolves.toBeNull()
    host.connect(2)
    await expect(host.resolve('p.png')).resolves.toEqual(BITMAP)
  })

  it('is not read again on every render while the same connection stays up', async () => {
    // A figure remounts (the document re-renders, Source and back): a read that did not answer is
    // asked again once per NEW connection, never once per mount on the connection it failed on.
    const host = liveHost([
      { throw: 'remote connection dropped' },
      { ok: false, error: { code: 'runtime_unavailable', message: 'Remote Orca runtime is not connected.' } },
      { ok: true, result: PNG }
    ])
    await expect(host.resolve('p.png')).resolves.toBeNull()
    await expect(host.resolve('p.png')).resolves.toBeNull()
    expect(host.calls).toHaveLength(1)
    host.connect(2)
    await expect(host.resolve('p.png')).resolves.toBeNull()
    await expect(host.resolve('p.png')).resolves.toBeNull()
    expect(host.calls).toHaveLength(2)
    host.connect(3)
    await expect(host.resolve('p.png')).resolves.toEqual(BITMAP)
    await expect(host.resolve('p.png')).resolves.toEqual(BITMAP)
    expect(host.calls).toHaveLength(3)
  })

  it('says in one line which figure it will read again, and why', async () => {
    const host = liveHost([
      { ok: false, error: { code: 'runtime_unavailable', message: 'Remote Orca runtime is not connected.' } }
    ])
    await host.resolve('fig/p.png')
    const warned = vi.mocked(console.warn).mock.calls
    expect(warned).toHaveLength(1)
    expect(JSON.stringify(warned[0])).toContain('fig/p.png')
    expect(JSON.stringify(warned[0])).toContain('Remote Orca runtime is not connected.')
  })
})

describe("a figure the file itself answered for", () => {
  it('asks once for a file the host said it has not got, across a new connection', async () => {
    const host = liveHost([
      { ok: false, error: { code: 'runtime_error', message: "ENOENT: no such file or directory, open '/w/gone.png'" } }
    ])
    await expect(host.resolve('gone.png')).resolves.toBeNull()
    host.connect(2)
    await expect(host.resolve('gone.png')).resolves.toBeNull()
    expect(host.calls).toHaveLength(1)
  })

  it.each([
    ['too large', { ok: false, error: { code: 'runtime_error', message: 'file_too_large' } }],
    ['too large, said by its code alone', { ok: false, error: { code: 'file_too_large', message: '' } }],
    ['binary, refused as such', { ok: false, error: { code: 'runtime_error', message: 'binary_file' } }],
    // The host answers a binary it cannot preview with its bytes and no mime type.
    ['binary, not an image', { ok: true, result: { content: 'AAAA', isBinary: true } }]
  ])('asks once for a file that is %s, across a new connection', async (_why, reply) => {
    const host = liveHost([reply])
    await expect(host.resolve('big.png')).resolves.toBeNull()
    host.connect(2)
    await expect(host.resolve('big.png')).resolves.toBeNull()
    expect(host.calls).toHaveLength(1)
  })

  it('asks once for an empty SVG and for a text file, across a new connection', async () => {
    const host = liveHost([
      { ok: true, result: { content: '', truncated: false, byteLength: 0 } },
      { ok: true, result: { content: 'hello', truncated: false, byteLength: 5 } }
    ])
    await expect(host.resolve('empty.svg')).resolves.toBeNull()
    await expect(host.resolve('notes.txt')).resolves.toBeNull()
    host.connect(2)
    await expect(host.resolve('empty.svg')).resolves.toBeNull()
    await expect(host.resolve('notes.txt')).resolves.toBeNull()
    expect(host.calls).toHaveLength(2)
  })
})

describe('two references to one figure', () => {
  it('share one read, and one more after a new connection', async () => {
    const host = liveHost([
      { ok: false, error: { code: 'timeout', message: 'Request timed out' } },
      { ok: true, result: PNG }
    ])
    const [first, second] = await Promise.all([host.resolve('p.png'), host.resolve('./p.png')])
    expect(first).toBeNull()
    expect(second).toBeNull()
    expect(host.calls).toHaveLength(1)
    host.connect(2)
    const again = await Promise.all([host.resolve('p.png'), host.resolve('./p.png')])
    expect(again).toEqual([BITMAP, BITMAP])
    expect(host.calls).toHaveLength(2)
  })
})
