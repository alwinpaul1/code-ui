import { describe, expect, it, vi } from 'vitest'

vi.mock('expo-file-system', () => ({ File: class {}, Paths: { cache: 'file:///cache' } }))
vi.mock('./mobile-pdf-cache', () => ({ resolveMobilePdfUri: vi.fn() }))

import { createMarkdownImageResolver } from './markdown-image-resolver'

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
