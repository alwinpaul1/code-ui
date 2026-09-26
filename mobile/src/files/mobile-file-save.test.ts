import { describe, expect, it, vi } from 'vitest'
import type { RpcFailure, RpcResponse, RpcSuccess } from '../transport/types'
import type { MobileFilePreviewRpcSender } from './mobile-file-preview-operations'
import {
  createSaveToPhoneRunner,
  saveDesktopFileToPhone,
  saveMimeTypeFor,
  suggestedSaveFileName,
  type MobileFileSaveTarget
} from './mobile-file-save'

// The host behaviour these fakes stand in for was read off Orca's own source
// (src/main/runtime/orca-runtime-files.ts at ac675ded6e): `files.readChunk`
// returns raw bytes for any local worktree file and refuses SSH worktrees;
// `files.read` and `files.readTerminalArtifact` stop at 512 KiB (the first
// truncates and says so, the second refuses with file_too_large); a binary
// extension is refused with binary_file; images come back whole, base64, up
// to 10 MB.

function ok(result: unknown): RpcSuccess {
  return { id: '1', ok: true, result, _meta: { runtimeId: 'runtime-1' } }
}

function fail(message: string, code = 'error'): RpcFailure {
  return { id: '1', ok: false, error: { code, message }, _meta: { runtimeId: 'runtime-1' } }
}

type Handler = (params: Record<string, unknown>) => RpcResponse

/** A desktop holding `files` in one local worktree, answering files.readChunk the way Orca does. */
function desktop(files: Record<string, Buffer>, handlers: Record<string, Handler> = {}) {
  const sendRequest = vi.fn(async (method: string, params: Record<string, unknown>) => {
    const handler = handlers[method]
    if (handler) {
      return handler(params)
    }
    if (method === 'files.readChunk') {
      const bytes = files[params.relativePath as string]
      if (!bytes) {
        return fail(`ENOENT: no such file or directory, open '${String(params.relativePath)}'`)
      }
      const offset = params.offset as number
      const slice = bytes.subarray(offset, offset + (params.length as number))
      return ok({
        contentBase64: slice.toString('base64'),
        bytesRead: slice.length,
        eof: offset + slice.length >= bytes.length
      })
    }
    return fail(`unexpected ${method}`)
  })
  // The port's send is generic over the method catalog; this fake answers by method name.
  return { sendRequest } as unknown as MobileFilePreviewRpcSender & {
    sendRequest: typeof sendRequest
  }
}

const SSH_CHUNK_REFUSAL: Handler = () =>
  fail('SSH runtime chunked download is unavailable; use the SSH download path')

/** The phone's side: the system "Save to" picker and the writes through the URI it hands back. */
function phone(overrides: Partial<MobileFileSaveTarget> = {}) {
  const written = new Map<string, string>()
  const target = {
    createDocument: vi.fn(async (_name: string, _mime: string) => 'content://downloads/document/7'),
    writeBase64: vi.fn(async (uri: string, base64: string) => {
      written.set(uri, base64)
    }),
    remove: vi.fn(async (uri: string) => {
      written.delete(uri)
    }),
    ...overrides
  }
  return { target, written }
}

const worktree = (relativePath: string) =>
  ({ source: 'worktree', worktreeId: 'wt-1', relativePath }) as const

describe('saving a desktop file onto the phone', () => {
  it('writes the file byte for byte where the user picked, paged over in chunks', async () => {
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x10, 0x80, 0x00, 0x7f, 0x01])
    const host = desktop({ 'dist/build.zip': bytes })
    const { target, written } = phone()

    const outcome = await saveDesktopFileToPhone(
      host,
      { source: worktree('dist/build.zip') },
      target,
      {
        chunkBytes: 3
      }
    )

    expect(outcome).toEqual({ status: 'saved', fileName: 'build.zip', byteLength: 11 })
    expect(target.createDocument).toHaveBeenCalledWith('build.zip', 'application/zip')
    expect(
      Buffer.from(written.get('content://downloads/document/7')!, 'base64').equals(bytes)
    ).toBe(true)
    expect(host.sendRequest.mock.calls.every(([method]) => method === 'files.readChunk')).toBe(true)
  })

  it('saves an empty file as an empty file instead of calling it unreadable', async () => {
    const host = desktop({ '.gitkeep': Buffer.alloc(0) })
    const { target, written } = phone()

    const outcome = await saveDesktopFileToPhone(host, { source: worktree('.gitkeep') }, target)

    expect(outcome).toEqual({ status: 'saved', fileName: '.gitkeep', byteLength: 0 })
    expect(written.get('content://downloads/document/7')).toBe('')
  })

  it('saves a one-byte file whole', async () => {
    const host = desktop({ 'flag.txt': Buffer.from('y') })
    const { target, written } = phone()

    const outcome = await saveDesktopFileToPhone(host, { source: worktree('flag.txt') }, target)

    expect(outcome).toMatchObject({ status: 'saved', byteLength: 1 })
    expect(written.get('content://downloads/document/7')).toBe(Buffer.from('y').toString('base64'))
  })

  it('refuses a file over the phone cap, says why, and never opens the picker', async () => {
    const host = desktop({ 'big.iso': Buffer.alloc(100, 7) })
    const { target } = phone()

    const outcome = await saveDesktopFileToPhone(host, { source: worktree('big.iso') }, target, {
      maxBytes: 50,
      chunkBytes: 30
    })

    expect(outcome).toEqual({
      status: 'refused',
      fileName: 'big.iso',
      message: "Can't save big.iso: it is over 50 B, the most the phone takes from the desktop"
    })
    expect(target.createDocument).not.toHaveBeenCalled()
    expect(target.writeBase64).not.toHaveBeenCalled()
  })

  it('names the desktop failure when the read fails, and opens no picker', async () => {
    const host = desktop({})
    const { target } = phone()

    const outcome = await saveDesktopFileToPhone(host, { source: worktree('gone.log') }, target)

    expect(outcome).toEqual({
      status: 'failed',
      fileName: 'gone.log',
      message: "Couldn't save gone.log: it is no longer on the desktop"
    })
    expect(target.createDocument).not.toHaveBeenCalled()
  })

  it('keeps the raw reason when the failure is one it has no words for', async () => {
    const host = desktop({}, { 'files.readChunk': () => fail('EACCES: permission denied') })
    const { target } = phone()

    const outcome = await saveDesktopFileToPhone(host, { source: worktree('secret.pem') }, target)

    expect(outcome).toEqual({
      status: 'failed',
      fileName: 'secret.pem',
      message: "Couldn't save secret.pem: EACCES: permission denied"
    })
  })

  it('does not fall back to a capped read when the chunked read broke for another reason', async () => {
    const read = vi.fn(() =>
      ok({ content: 'first part only', truncated: true, byteLength: 900_000 })
    )
    const host = desktop(
      {},
      { 'files.readChunk': () => fail('remote connection dropped'), 'files.read': read }
    )
    const { target } = phone()

    const outcome = await saveDesktopFileToPhone(host, { source: worktree('big.log') }, target)

    expect(outcome).toEqual({
      status: 'failed',
      fileName: 'big.log',
      message: "Couldn't save big.log: the desktop could not be reached"
    })
    expect(read).not.toHaveBeenCalled()
  })

  it('reports cancelled and writes nothing when the picker is dismissed', async () => {
    const host = desktop({ 'a.txt': Buffer.from('hello') })
    const { target } = phone({ createDocument: vi.fn(async () => null) })

    const outcome = await saveDesktopFileToPhone(host, { source: worktree('a.txt') }, target)

    expect(outcome).toEqual({ status: 'cancelled', fileName: 'a.txt' })
    expect(target.writeBase64).not.toHaveBeenCalled()
  })

  it('leaves no half-written file behind when the phone write fails', async () => {
    const host = desktop({ 'a.txt': Buffer.from('hello') })
    const { target } = phone({
      writeBase64: vi.fn(async () => {
        throw new Error('ENOSPC: no space left on device')
      })
    })

    const outcome = await saveDesktopFileToPhone(host, { source: worktree('a.txt') }, target)

    expect(outcome).toEqual({
      status: 'failed',
      fileName: 'a.txt',
      message: "Couldn't save a.txt: the phone could not write it (ENOSPC: no space left on device)"
    })
    expect(target.remove).toHaveBeenCalledWith('content://downloads/document/7')
  })

  it('still reports the write failure when removing the partial file fails too', async () => {
    const host = desktop({ 'a.txt': Buffer.from('hello') })
    const { target } = phone({
      writeBase64: vi.fn(async () => {
        throw new Error('EIO')
      }),
      remove: vi.fn(async () => {
        throw new Error('gone')
      })
    })

    const outcome = await saveDesktopFileToPhone(host, { source: worktree('a.txt') }, target)

    expect(outcome).toEqual({
      status: 'failed',
      fileName: 'a.txt',
      message:
        "Couldn't save a.txt: the phone could not write it (EIO). An incomplete a.txt is left " +
        'where you chose to save it; delete it there'
    })
  })

  it('says so when the picker itself cannot open', async () => {
    const host = desktop({ 'a.txt': Buffer.from('hello') })
    const { target } = phone({
      createDocument: vi.fn(async () => {
        throw new Error('No Activity found to handle Intent')
      })
    })

    const outcome = await saveDesktopFileToPhone(host, { source: worktree('a.txt') }, target)

    expect(outcome).toEqual({
      status: 'failed',
      fileName: 'a.txt',
      message:
        "Couldn't save a.txt: the phone's save picker did not open (No Activity found to handle Intent)"
    })
    expect(target.writeBase64).not.toHaveBeenCalled()
  })
})

describe('a host with no chunked read (an SSH worktree)', () => {
  it('saves text that arrived whole through the capped read', async () => {
    const host = desktop(
      {},
      {
        'files.readChunk': SSH_CHUNK_REFUSAL,
        'files.read': () => ok({ content: 'héllo\n', truncated: false, byteLength: 7 })
      }
    )
    const { target, written } = phone()

    const outcome = await saveDesktopFileToPhone(
      host,
      { source: worktree('notes/today.md') },
      target
    )

    expect(outcome).toEqual({ status: 'saved', fileName: 'today.md', byteLength: 7 })
    expect(
      Buffer.from(written.get('content://downloads/document/7')!, 'base64').toString('utf8')
    ).toBe('héllo\n')
  })

  it('refuses text the desktop cut at its read cap instead of saving the first part as the file', async () => {
    const host = desktop(
      {},
      {
        'files.readChunk': SSH_CHUNK_REFUSAL,
        // The host's byteLength on a cut read is what it read (512 KiB and a byte), not the file.
        'files.read': () => ok({ content: 'x'.repeat(64), truncated: true, byteLength: 524_289 })
      }
    )
    const { target } = phone()

    const outcome = await saveDesktopFileToPhone(host, { source: worktree('server.log') }, target)

    expect(outcome).toEqual({
      status: 'refused',
      fileName: 'server.log',
      message: "Can't save server.log: the desktop sends only the first 512 KB of it"
    })
    expect(target.createDocument).not.toHaveBeenCalled()
  })

  it('refuses a binary the desktop only previews', async () => {
    const host = desktop(
      {},
      {
        'files.readChunk': SSH_CHUNK_REFUSAL,
        'files.read': () => fail('binary_file', 'binary_file')
      }
    )
    const { target } = phone()

    const outcome = await saveDesktopFileToPhone(host, { source: worktree('report.docx') }, target)

    expect(outcome).toEqual({
      status: 'refused',
      fileName: 'report.docx',
      message:
        "Can't save report.docx: the desktop sends only a preview of this kind of file, not the file"
    })
  })

  it('refuses text that did not decode cleanly, since the bytes it came from are gone', async () => {
    const host = desktop(
      {},
      {
        'files.readChunk': SSH_CHUNK_REFUSAL,
        'files.read': () => ok({ content: 'caf\uFFFD', truncated: false, byteLength: 4 })
      }
    )
    const { target } = phone()

    const outcome = await saveDesktopFileToPhone(host, { source: worktree('latin1.txt') }, target)

    expect(outcome).toMatchObject({ status: 'refused' })
    expect(target.createDocument).not.toHaveBeenCalled()
  })

  it('saves an image whole from the preview read', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const host = desktop(
      {},
      {
        'files.readChunk': SSH_CHUNK_REFUSAL,
        'files.readPreview': () =>
          ok({
            content: png.toString('base64'),
            isBinary: true,
            isImage: true,
            mimeType: 'image/png'
          })
      }
    )
    const { target, written } = phone()

    const outcome = await saveDesktopFileToPhone(host, { source: worktree('shot.png') }, target)

    expect(outcome).toEqual({ status: 'saved', fileName: 'shot.png', byteLength: 8 })
    expect(target.createDocument).toHaveBeenCalledWith('shot.png', 'image/png')
    expect(written.get('content://downloads/document/7')).toBe(png.toString('base64'))
  })

  it('refuses an image over the desktop preview cap and names the cap', async () => {
    const host = desktop(
      {},
      {
        'files.readChunk': SSH_CHUNK_REFUSAL,
        'files.readPreview': () => fail('file_too_large', 'file_too_large')
      }
    )
    const { target } = phone()

    const outcome = await saveDesktopFileToPhone(host, { source: worktree('huge.png') }, target)

    expect(outcome).toEqual({
      status: 'refused',
      fileName: 'huge.png',
      message: "Can't save huge.png: it is larger than the 10 MB the desktop sends of this file"
    })
  })
})

describe('a file outside the workspace, read through a terminal grant', () => {
  const artifact = (absolutePath: string) =>
    ({ source: 'terminalArtifact', worktreeId: 'wt-1', absolutePath, grantId: 'grant-1' }) as const

  it('saves text the grant reads whole', async () => {
    const host = desktop(
      {},
      {
        'files.readTerminalArtifact': (params) => {
          expect(params).toEqual({
            worktree: 'id:wt-1',
            absolutePath: '/tmp/out/result.json',
            grantId: 'grant-1'
          })
          return ok({ content: '{"ok":true}', truncated: false, byteLength: 11 })
        }
      }
    )
    const { target, written } = phone()

    const outcome = await saveDesktopFileToPhone(
      host,
      { source: artifact('/tmp/out/result.json') },
      target
    )

    expect(outcome).toEqual({ status: 'saved', fileName: 'result.json', byteLength: 11 })
    expect(target.createDocument).toHaveBeenCalledWith('result.json', 'application/json')
    expect(Buffer.from(written.get('content://downloads/document/7')!, 'base64').toString()).toBe(
      '{"ok":true}'
    )
  })

  it('refuses text over the desktop cap for such a file', async () => {
    const host = desktop(
      {},
      { 'files.readTerminalArtifact': () => fail('file_too_large', 'file_too_large') }
    )
    const { target } = phone()

    const outcome = await saveDesktopFileToPhone(
      host,
      { source: artifact('/tmp/trace.log') },
      target
    )

    expect(outcome).toEqual({
      status: 'refused',
      fileName: 'trace.log',
      message: "Can't save trace.log: it is larger than the 512 KB the desktop sends of this file"
    })
  })

  it('saves an image through the grant preview read', async () => {
    const host = desktop(
      {},
      {
        'files.readTerminalArtifactPreview': () =>
          ok({
            content: 'R0lGODlhAQABAAAAACw=',
            isBinary: true,
            isImage: true,
            mimeType: 'image/gif'
          })
      }
    )
    const { target, written } = phone()

    const outcome = await saveDesktopFileToPhone(host, { source: artifact('/tmp/dot.gif') }, target)

    expect(outcome).toEqual({ status: 'saved', fileName: 'dot.gif', byteLength: 14 })
    expect(written.get('content://downloads/document/7')).toBe('R0lGODlhAQABAAAAACw=')
  })

  it('re-mints a stale grant once and reads again', async () => {
    let reads = 0
    const host = desktop(
      {},
      {
        'files.readTerminalArtifact': (params) => {
          reads += 1
          return params.grantId === 'grant-2'
            ? ok({ content: 'fresh', truncated: false, byteLength: 5 })
            : fail('terminal_file_grant_expired', 'terminal_file_grant_expired')
        },
        'files.resolveTerminalPath': () =>
          ok({
            exists: true,
            isDirectory: false,
            openTarget: { kind: 'absolute-file', absolutePath: '/tmp/a.txt', grantId: 'grant-2' }
          })
      }
    )
    const { target } = phone()

    const outcome = await saveDesktopFileToPhone(host, { source: artifact('/tmp/a.txt') }, target)

    expect(outcome).toMatchObject({ status: 'saved', byteLength: 5 })
    expect(reads).toBe(2)
  })
})

describe('a session file tab', () => {
  it('reads a worktree path in chunks', async () => {
    const host = desktop({ 'src/app.ts': Buffer.from('export {}\n') })
    const { target } = phone()

    const outcome = await saveDesktopFileToPhone(
      host,
      {
        source: { source: 'fileTab', worktreeId: 'wt-1', path: 'src/app.ts', terminalHandles: [] }
      },
      target
    )

    expect(outcome).toEqual({ status: 'saved', fileName: 'app.ts', byteLength: 10 })
    expect(host.sendRequest).toHaveBeenCalledWith(
      'files.readChunk',
      expect.objectContaining({ worktree: 'id:wt-1', relativePath: 'src/app.ts' })
    )
  })

  it('reads an absolute path through the grant a terminal vouches for', async () => {
    const host = desktop(
      {},
      {
        'files.resolveTerminalPath': (params) =>
          params.terminal === 'term-1'
            ? ok({
                worktree: 'wt-1',
                exists: true,
                isDirectory: false,
                openTarget: {
                  kind: 'absolute-file',
                  absolutePath: '/tmp/plan.md',
                  grantId: 'grant-9'
                }
              })
            : fail('not vouched'),
        'files.readTerminalArtifact': (params) =>
          params.grantId === 'grant-9'
            ? ok({ content: '# Plan\n', truncated: false, byteLength: 7 })
            : fail('terminal_file_grant_mismatch')
      }
    )
    const { target } = phone()

    const outcome = await saveDesktopFileToPhone(
      host,
      {
        source: {
          source: 'fileTab',
          worktreeId: 'wt-1',
          path: '/tmp/plan.md',
          terminalHandles: ['term-1']
        }
      },
      target
    )

    expect(outcome).toEqual({ status: 'saved', fileName: 'plan.md', byteLength: 7 })
  })

  it('says why when no terminal vouches for an absolute path any more', async () => {
    const host = desktop({}, { 'files.resolveTerminalPath': () => fail('not vouched') })
    const { target } = phone()

    const outcome = await saveDesktopFileToPhone(
      host,
      {
        source: { source: 'fileTab', worktreeId: 'wt-1', path: '/tmp/plan.md', terminalHandles: [] }
      },
      target
    )

    expect(outcome).toEqual({
      status: 'failed',
      fileName: 'plan.md',
      message:
        "Couldn't save plan.md: the phone can reach a file outside the workspace only while a terminal here still shows its path"
    })
  })
})

describe('the name and type the picker is offered', () => {
  it('suggests the file name, not its folders', () => {
    expect(suggestedSaveFileName('docs/out/Report.PDF')).toBe('Report.PDF')
    expect(suggestedSaveFileName('C:\\work\\notes.txt')).toBe('notes.txt')
    expect(suggestedSaveFileName('dir/')).toBe('dir')
    expect(suggestedSaveFileName('')).toBe('file')
  })

  it('names a type only where Android keeps the file name as given', () => {
    expect(saveMimeTypeFor('a.pdf')).toBe('application/pdf')
    expect(saveMimeTypeFor('a.JPG')).toBe('image/jpeg')
    // Android appends the extension of the type it is given when the name's
    // own extension maps elsewhere (".ts" with text/plain became
    // "app.ts.txt"), and leaves the name alone for octet-stream.
    expect(saveMimeTypeFor('app.ts')).toBe('application/octet-stream')
    expect(saveMimeTypeFor('README.md')).toBe('application/octet-stream')
    expect(saveMimeTypeFor('Makefile')).toBe('application/octet-stream')
  })
})

describe('the feedback a save gives', () => {
  it('says it is fetching, then what it saved', async () => {
    const host = desktop({ 'a.txt': Buffer.from('hello') })
    const { target } = phone()
    const notify = vi.fn()
    const run = createSaveToPhoneRunner(target)

    const outcome = await run({ client: host, source: worktree('a.txt'), notify })

    expect(outcome.status).toBe('saved')
    expect(notify.mock.calls.map(([message]) => message)).toEqual([
      'Getting a.txt from the desktop…',
      'Saved a.txt (5 B)'
    ])
  })

  it('shows the refusal as it is', async () => {
    const host = desktop({ 'big.iso': Buffer.alloc(100) })
    const { target } = phone()
    const notify = vi.fn()
    const run = createSaveToPhoneRunner(target, { maxBytes: 50, chunkBytes: 30 })

    await run({ client: host, source: worktree('big.iso'), notify })

    expect(notify.mock.calls.at(-1)?.[0]).toBe(
      "Can't save big.iso: it is over 50 B, the most the phone takes from the desktop"
    )
  })

  it('reports progress on a long read', async () => {
    const host = desktop({ 'video.mp4': Buffer.alloc(3 * 1024 * 1024 + 5) })
    const { target } = phone()
    const notify = vi.fn()
    const run = createSaveToPhoneRunner(target, { chunkBytes: 512 * 1024 })

    await run({ client: host, source: worktree('video.mp4'), notify })

    expect(notify.mock.calls.map(([message]) => message)).toEqual([
      'Getting video.mp4 from the desktop…',
      'Getting video.mp4… 1.0 MB',
      'Getting video.mp4… 2.0 MB',
      'Getting video.mp4… 3.0 MB',
      'Saved video.mp4 (3.0 MB)'
    ])
  })

  it('says a cancelled save was not saved, so the fetching notice does not linger', async () => {
    const host = desktop({ 'a.txt': Buffer.from('hello') })
    const { target } = phone({ createDocument: vi.fn(async () => null) })
    const notify = vi.fn()

    await createSaveToPhoneRunner(target)({ client: host, source: worktree('a.txt'), notify })

    expect(notify.mock.calls.at(-1)?.[0]).toBe('Not saved')
  })

  it('refuses a second save of the same file while the first is still running', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const host = desktop({ 'a.txt': Buffer.from('hello') })
    const { target } = phone({
      createDocument: vi.fn(async () => {
        await gate
        return 'content://downloads/document/7'
      })
    })
    const notify = vi.fn()
    const run = createSaveToPhoneRunner(target)

    const first = run({ client: host, source: worktree('a.txt'), notify })
    const second = await run({ client: host, source: worktree('a.txt'), notify })
    release()

    expect(second.status).toBe('busy')
    expect(notify).toHaveBeenCalledWith('Already saving a.txt', expect.any(Number))
    expect((await first).status).toBe('saved')
    // Once the first is done, the same file saves again.
    expect((await run({ client: host, source: worktree('a.txt'), notify })).status).toBe('saved')
  })
})
