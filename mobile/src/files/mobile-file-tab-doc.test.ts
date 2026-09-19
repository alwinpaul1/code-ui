import { describe, expect, it, vi } from 'vitest'
import type { RpcResponse } from '../transport/types'
import { resolveMobileFileTabDoc } from './mobile-file-tab-doc'

vi.mock('expo-file-system', () => ({ File: class {}, Paths: { cache: 'file:///cache' } }))
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l8sm7wAAAABJRU5ErkJggg=='

function ok(result: unknown): RpcResponse {
  return { id: 'x', ok: true, result, _meta: { runtimeId: 'r' } }
}

function fail(code: string, message: string): RpcResponse {
  return { id: 'x', ok: false, error: { code, message }, _meta: { runtimeId: 'r' } }
}

// Fake client that returns a canned response per RPC method.
function clientOf(byMethod: Record<string, RpcResponse>): {
  sendRequest: (method: string) => Promise<RpcResponse>
  calls: string[]
} {
  const calls: string[] = []
  return {
    calls,
    sendRequest: (method: string) => {
      calls.push(method)
      const response = byMethod[method]
      if (!response) {
        throw new Error(`unexpected method ${method}`)
      }
      return Promise.resolve(response)
    }
  }
}

const WT = { worktreeId: 'wt1' }

describe('a file tab the desktop opened outside the worktree', () => {
  // Device 2026-09-19, "Cant preview image from my desktop": the desktop had
  // opened /private/tmp/…/fstrip2.png (printed by the agent, clicked in the
  // terminal) and published the tab with that absolute path as its
  // `relativePath`. The phone asked files.readPreview for it as a
  // worktree-relative path, the host refused, and the tab said "Couldn't
  // load file preview". A path outside the worktree is a terminal artifact:
  // the phone asks the host to resolve it against the terminal that printed
  // it, gets a grant, and reads through the grant — the same path a tapped
  // path in the terminal already takes.
  const ABSOLUTE = '/private/tmp/claude-501/scratch/fstrip2.png'
  const GRANT = { kind: 'absolute-file', absolutePath: ABSOLUTE, grantId: 'grant-1' }

  it('reads an image through a terminal-artifact grant minted for the terminal that printed it', async () => {
    const seen: unknown[] = []
    const client = {
      sendRequest: (method: string, params: unknown) => {
        seen.push({ method, params })
        if (method === 'files.resolveTerminalPath') {
          const terminal = (params as { terminal?: string }).terminal
          return Promise.resolve(
            ok(
              terminal === 'term_agent'
                ? { worktree: 'wt1', exists: true, isDirectory: false, openTarget: GRANT }
                : { worktree: 'wt1', relativePath: null, absolutePath: ABSOLUTE, exists: false, isDirectory: false }
            )
          )
        }
        if (method === 'files.readTerminalArtifactPreview') {
          return Promise.resolve(ok({ isImage: true, mimeType: 'image/png', content: PNG_BASE64 }))
        }
        return Promise.reject(new Error(`unexpected method ${method}`))
      }
    }
    const doc = await resolveMobileFileTabDoc(client as never, {
      ...WT,
      relativePath: ABSOLUTE,
      terminalHandles: ['term_other', 'term_agent']
    })
    expect(doc).toMatchObject({ status: 'ready', kind: 'image' })
    expect(seen.map((s) => (s as { method: string }).method)).toEqual([
      'files.resolveTerminalPath',
      'files.resolveTerminalPath',
      'files.readTerminalArtifactPreview'
    ])
    expect((seen[0] as { params: object }).params).toMatchObject({
      worktree: 'id:wt1',
      pathText: ABSOLUTE,
      crossWorkspace: true,
      terminal: 'term_other'
    })
    expect((seen[2] as { params: object }).params).toMatchObject({
      worktree: 'id:wt1',
      absolutePath: ABSOLUTE,
      grantId: 'grant-1'
    })
  })

  it('reads text the same way, and a file in another worktree through that worktree', async () => {
    const client = clientOf({
      'files.resolveTerminalPath': ok({
        worktree: 'wt1',
        exists: true,
        isDirectory: false,
        openTarget: { ...GRANT, absolutePath: '/private/tmp/x/notes.txt' }
      }),
      'files.readTerminalArtifact': ok({ content: 'hello', truncated: false, byteLength: 5 })
    })
    const doc = await resolveMobileFileTabDoc(client as never, {
      ...WT,
      relativePath: '/private/tmp/x/notes.txt',
      terminalHandles: ['term_agent']
    })
    expect(doc).toMatchObject({ status: 'ready', kind: 'file', content: 'hello' })

    const other = clientOf({
      'files.resolveTerminalPath': ok({
        worktree: 'wt2',
        relativePath: 'README.md',
        absolutePath: '/Users/me/other/README.md',
        exists: true,
        isDirectory: false,
        openTarget: { kind: 'worktree-file', provider: 'local', relativePath: 'README.md' }
      }),
      'files.read': ok({ content: '# Other', truncated: false, byteLength: 7 })
    })
    const md = await resolveMobileFileTabDoc(other as never, {
      ...WT,
      relativePath: '/Users/me/other/README.md',
      terminalHandles: []
    })
    expect(md).toMatchObject({ status: 'ready', kind: 'markdown', content: '# Other' })
    expect(other.calls).toEqual(['files.resolveTerminalPath', 'files.read'])
  })

  it('says the file is out of reach when no terminal vouches for the path', async () => {
    const client = clientOf({
      'files.resolveTerminalPath': ok({
        worktree: 'wt1',
        relativePath: null,
        absolutePath: ABSOLUTE,
        exists: false,
        isDirectory: false
      })
    })
    await expect(
      resolveMobileFileTabDoc(client as never, { ...WT, relativePath: ABSOLUTE, terminalHandles: ['t1'] })
    ).rejects.toThrow('outside_worktree')
    // Never files.readPreview with an absolute path: the host refuses it.
    expect(client.calls).not.toContain('files.readPreview')
  })
})

describe('resolveMobileFileTabDoc', () => {
  it('renders a staged text diff', async () => {
    const client = clientOf({
      'git.diff': ok({ kind: 'text', originalContent: 'a\n', modifiedContent: 'a\nb\n' })
    })
    const doc = await resolveMobileFileTabDoc(client, {
      ...WT,
      relativePath: 'a.ts',
      diffSource: 'staged'
    })
    expect(doc.kind).toBe('diff')
    expect(client.calls).toEqual(['git.diff'])
  })

  it('renders an unstaged image diff from the modified bytes', async () => {
    const client = clientOf({
      'git.diff': ok({
        kind: 'binary',
        originalContent: PNG_BASE64,
        modifiedContent: PNG_BASE64,
        modifiedIsBinary: true,
        isImage: true,
        mimeType: 'image/png'
      })
    })
    const doc = await resolveMobileFileTabDoc(client, {
      ...WT,
      relativePath: 'm1.png',
      diffSource: 'unstaged'
    })
    expect(doc).toEqual({
      status: 'ready',
      kind: 'image',
      dataUri: `data:image/png;base64,${PNG_BASE64}`
    })
  })

  it('throws binary_file for an image modify whose bytes are empty (no stale fallback)', async () => {
    const client = clientOf({
      'git.diff': ok({
        kind: 'binary',
        originalContent: 'b2xk',
        modifiedContent: '',
        modifiedIsBinary: true,
        isImage: true,
        mimeType: 'image/png'
      })
    })
    await expect(
      resolveMobileFileTabDoc(client, { ...WT, relativePath: 'm1.png', diffSource: 'unstaged' })
    ).rejects.toThrow('binary_file')
  })

  it('throws binary_file for a non-image binary diff', async () => {
    const client = clientOf({ 'git.diff': ok({ kind: 'binary', modifiedContent: 'AAAA' }) })
    await expect(
      resolveMobileFileTabDoc(client, { ...WT, relativePath: 'a.bin', diffSource: 'unstaged' })
    ).rejects.toThrow('binary_file')
  })

  it('renders a live image preview via files.readPreview', async () => {
    const client = clientOf({
      'files.readPreview': ok({ content: PNG_BASE64, isImage: true, mimeType: 'image/png' })
    })
    const doc = await resolveMobileFileTabDoc(client, { ...WT, relativePath: 'logo.png' })
    expect(doc).toEqual({
      status: 'ready',
      kind: 'image',
      dataUri: `data:image/png;base64,${PNG_BASE64}`
    })
    expect(client.calls).toEqual(['files.readPreview'])
  })

  it('throws binary_file when readPreview returns no image bytes', async () => {
    const client = clientOf({
      'files.readPreview': ok({ content: '', isImage: true, mimeType: 'image/png' })
    })
    await expect(
      resolveMobileFileTabDoc(client, { ...WT, relativePath: 'logo.png' })
    ).rejects.toThrow('binary_file')
  })

  it('renders html source via files.read', async () => {
    const client = clientOf({
      'files.read': ok({ content: '<h1>hi</h1>', truncated: false, byteLength: 11 })
    })
    const doc = await resolveMobileFileTabDoc(client, { ...WT, relativePath: 'page.html' })
    expect(doc).toEqual({ status: 'ready', kind: 'html', content: '<h1>hi</h1>' })
  })

  // Why: markdown renders as a document, so the reader cannot see where the text
  // stops. The host's truncation facts have to travel with it or a cut-off
  // CLAUDE.md reads as the whole file.
  it('says a markdown file was cut off instead of rendering the stump as the document', async () => {
    const client = clientOf({
      'files.read': ok({ content: '# Rules', truncated: true, byteLength: 400_000 })
    })
    const doc = await resolveMobileFileTabDoc(client, { ...WT, relativePath: 'CLAUDE.md' })
    expect(doc).toEqual({
      status: 'ready',
      kind: 'markdown',
      content: '# Rules',
      truncated: true,
      byteLength: 400_000
    })
  })

  it('renders a plain text file via files.read', async () => {
    const client = clientOf({
      'files.read': ok({ content: 'hello', truncated: true, byteLength: 5 })
    })
    const doc = await resolveMobileFileTabDoc(client, { ...WT, relativePath: 'notes.txt' })
    expect(doc).toEqual({
      status: 'ready',
      kind: 'file',
      content: 'hello',
      truncated: true,
      byteLength: 5
    })
  })

  // Why: the host now caps oversized diffs with an error envelope, and a client that knows nothing
  // about the code must still surface the message instead of rendering an empty diff.
  it('propagates a host diff_too_large failure instead of rendering an empty diff', async () => {
    const client = clientOf({
      'git.diff': fail('diff_too_large', 'This diff is too large to open over a remote connection.')
    })
    await expect(
      resolveMobileFileTabDoc(client, { ...WT, relativePath: 'a.ts', diffSource: 'staged' })
    ).rejects.toThrow('This diff is too large to open over a remote connection.')
  })

  it('propagates the RPC error message when a read fails', async () => {
    const client = clientOf({ 'files.read': fail('EIO', 'file_too_large') })
    await expect(
      resolveMobileFileTabDoc(client, { ...WT, relativePath: 'notes.txt' })
    ).rejects.toThrow('file_too_large')
  })
})
