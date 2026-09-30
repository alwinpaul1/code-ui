import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('expo-file-system', () => ({ File: class {}, Paths: { cache: 'file:///cache' } }))
vi.mock('./mobile-pdf-cache', () => ({ resolveMobilePdfUri: vi.fn() }))

import { createMarkdownImageResolver } from './markdown-image-resolver'
import { resolveMobilePdfUri } from './mobile-pdf-cache'

function host(answers: Record<string, unknown>) {
  const calls: { method: string; params: Record<string, unknown> }[] = []
  const client = {
    sendRequest: vi.fn(async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params })
      const answer = answers[String(params.relativePath)]
      if (answer === undefined) {
        return { ok: false, error: { code: 'not_found', message: 'no such file' } }
      }
      return { ok: true, result: answer }
    })
  }
  return { client: client as never, calls }
}

const DOC = 'scratchpad/thesis_explained/thesis_explained.md'

describe('images a markdown document names', () => {
  it('reads a bitmap beside the document through the preview RPC', async () => {
    const h = host({
      'scratchpad/thesis_explained/fig/plot.png': {
        isBinary: true,
        isImage: true,
        mimeType: 'image/png',
        content: 'iVBORw0KGgo='
      }
    })
    const resolve = createMarkdownImageResolver({ client: h.client, worktreeId: 'wt', documentRelativePath: DOC })
    await expect(resolve('fig/plot.png')).resolves.toEqual({
      kind: 'bitmap',
      uri: 'data:image/png;base64,iVBORw0KGgo='
    })
    expect(h.calls[0]).toMatchObject({
      method: 'files.readPreview',
      params: { worktree: 'id:wt', relativePath: 'scratchpad/thesis_explained/fig/plot.png' }
    })
  })

  it('reads an SVG as text, since Image cannot draw one', async () => {
    const xml = '<svg viewBox="0 0 10 5"><rect width="10" height="5"/></svg>'
    const h = host({
      'scratchpad/thesis_explained/fig/fig3_cka.svg': { content: xml, truncated: false, byteLength: xml.length }
    })
    const resolve = createMarkdownImageResolver({ client: h.client, worktreeId: 'wt', documentRelativePath: DOC })
    await expect(resolve('fig/fig3_cka.svg')).resolves.toEqual({ kind: 'svg', xml })
    expect(h.calls[0]?.method).toBe('files.read')
  })

  it('fetches a figure once however many times the document renders it', async () => {
    const h = host({
      'scratchpad/thesis_explained/fig/plot.png': {
        isBinary: true,
        isImage: true,
        mimeType: 'image/png',
        content: 'AAAA'
      }
    })
    const resolve = createMarkdownImageResolver({ client: h.client, worktreeId: 'wt', documentRelativePath: DOC })
    await Promise.all([resolve('fig/plot.png'), resolve('fig/plot.png'), resolve('./fig/plot.png')])
    expect(h.calls).toHaveLength(1)
  })

  it('answers null for a file the host has not got, a path outside the worktree, and no client', async () => {
    const h = host({})
    const resolve = createMarkdownImageResolver({ client: h.client, worktreeId: 'wt', documentRelativePath: DOC })
    await expect(resolve('fig/missing.png')).resolves.toBeNull()
    await expect(resolve('../../../../etc/passwd')).resolves.toBeNull()
    const offline = createMarkdownImageResolver({ client: null, worktreeId: 'wt', documentRelativePath: DOC })
    await expect(offline('fig/plot.png')).resolves.toBeNull()
  })

  it('reads a figure named with a bare percent sign instead of throwing out of the caller', async () => {
    // `![chart](100%.png)`: the path was decoded before the promise existed, so the URIError
    // escaped the resolver synchronously, past its own catch.
    const h = host({
      'docs/100%.png': { isBinary: true, isImage: true, mimeType: 'image/png', content: 'AAAA' }
    })
    const resolve = createMarkdownImageResolver({
      client: h.client,
      worktreeId: 'wt',
      documentRelativePath: 'docs/README.md'
    })
    let answer: Promise<unknown> | null = null
    expect(() => {
      answer = resolve('100%.png')
    }).not.toThrow()
    await expect(answer).resolves.toEqual({ kind: 'bitmap', uri: 'data:image/png;base64,AAAA' })
  })

  it('does not pass off a text file, or a cut SVG, as an image', async () => {
    const h = host({
      'notes.svg': { content: '<svg viewBox="0 0 1 1">', truncated: true, byteLength: 999999 },
      'notes.txt': { content: 'hello', truncated: false, byteLength: 5 }
    })
    const resolve = createMarkdownImageResolver({ client: h.client, worktreeId: 'wt', documentRelativePath: 'README.md' })
    await expect(resolve('notes.svg')).resolves.toBeNull()
    await expect(resolve('notes.txt')).resolves.toBeNull()
  })
})

type ScriptedReply = { throw: string } | { ok: boolean; result?: unknown; error?: unknown }

/** A client whose reads answer from a script, in order; `throw` rejects the way a dropped link does. */
function scripted(replies: ScriptedReply[]) {
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
    })
  }
  return { client: client as never, calls }
}

const PNG = { isBinary: true, isImage: true, mimeType: 'image/png', content: 'AAAA' }

function readmeResolver(client: never) {
  return createMarkdownImageResolver({ client, worktreeId: 'wt', documentRelativePath: 'README.md' })
}

describe('a figure read while the host was not reachable', () => {
  // Review 2026-09-30: a read that failed during a reconnect cached null for the life of the
  // document, so the figure stayed a link over a healthy connection until the tab was closed.
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is read again on the next render when the read rejected', async () => {
    const h = scripted([{ throw: 'remote connection dropped' }, { ok: true, result: PNG }])
    const resolve = readmeResolver(h.client)
    await expect(resolve('p.png')).resolves.toBeNull()
    await expect(resolve('p.png')).resolves.toEqual({
      kind: 'bitmap',
      uri: 'data:image/png;base64,AAAA'
    })
    expect(h.calls).toHaveLength(2)
  })

  it('is read again when the host answered that its filesystem was unreachable', async () => {
    const h = scripted([
      { ok: false, error: { code: 'unavailable', message: 'remote connection dropped' } },
      { ok: true, result: PNG }
    ])
    const resolve = readmeResolver(h.client)
    await expect(resolve('p.png')).resolves.toBeNull()
    await expect(resolve('p.png')).resolves.toEqual({
      kind: 'bitmap',
      uri: 'data:image/png;base64,AAAA'
    })
  })

  it('says in one line why a figure could not be read', async () => {
    const h = scripted([{ throw: 'remote connection dropped' }])
    await readmeResolver(h.client)('p.png')
    const warned = vi.mocked(console.warn).mock.calls
    expect(warned).toHaveLength(1)
    expect(JSON.stringify(warned[0])).toContain('p.png')
  })

  it('shares one read between the renders that asked while it was out', async () => {
    const h = scripted([{ throw: 'remote connection dropped' }, { ok: true, result: PNG }])
    const resolve = readmeResolver(h.client)
    await Promise.all([resolve('p.png'), resolve('p.png')])
    expect(h.calls).toHaveLength(1)
  })

  it('still asks once for a file the host said it has not got', async () => {
    const h = scripted([{ ok: false, error: { code: 'not_found', message: 'no such file' } }])
    const resolve = readmeResolver(h.client)
    await expect(resolve('gone.png')).resolves.toBeNull()
    await expect(resolve('gone.png')).resolves.toBeNull()
    expect(h.calls).toHaveLength(1)
  })

  it('still asks once for a text file that is not an image', async () => {
    const h = scripted([{ ok: true, result: { content: 'hello', truncated: false, byteLength: 5 } }])
    const resolve = readmeResolver(h.client)
    await expect(resolve('notes.txt')).resolves.toBeNull()
    await expect(resolve('notes.txt')).resolves.toBeNull()
    expect(h.calls).toHaveLength(1)
  })

  it('never downloads a PDF a document names as an image, since none can be drawn', async () => {
    // The preview loader pages a PDF over in chunks; the resolver threw the whole file away, and a
    // PDF that failed to arrive would otherwise be paged over again on every new connection.
    vi.mocked(resolveMobilePdfUri).mockClear()
    const h = scripted([])
    await expect(readmeResolver(h.client)('paper.pdf')).resolves.toBeNull()
    expect(resolveMobilePdfUri).not.toHaveBeenCalled()
    expect(h.calls).toHaveLength(0)
  })

  it('hands a figure the connection to watch when the client has one, and none otherwise', () => {
    const listeners: (() => void)[] = []
    let connectedAt: number | null = 1
    const client = {
      sendRequest: vi.fn(),
      getLastConnectedAt: () => connectedAt,
      onStateChange: (listener: () => void) => {
        listeners.push(listener)
        return () => {
          listeners.splice(listeners.indexOf(listener), 1)
        }
      }
    }
    const resolve = readmeResolver(client as never)
    const heard = vi.fn()
    const stop = resolve.connection!.subscribe(heard)
    connectedAt = 2
    for (const listener of listeners) {
      listener()
    }
    expect(resolve.connection!.lastConnectedAt()).toBe(2)
    expect(heard).toHaveBeenCalledTimes(1)
    stop()
    expect(listeners).toHaveLength(0)
    expect(readmeResolver(scripted([]).client).connection).toBeUndefined()
    expect(readmeResolver(null as never).connection).toBeUndefined()
  })
})
