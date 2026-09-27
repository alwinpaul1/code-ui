import { describe, expect, it, vi } from 'vitest'
import type { RpcFailure, RpcResponse, RpcSuccess } from '../transport/types'
import type { MobileFilePreviewRpcSender } from './mobile-file-preview-operations'
import { saveDesktopFileToPhone, type MobileFileSaveTarget } from './mobile-file-save'

// Every reply below is what Orca's own source sends (orca src/main/runtime/orca-runtime-files.ts
// and src/relay/fs-handler-file-read.ts at ac675ded6e), not an invented shape:
//
// - files.read on a LOCAL worktree (readLocalMobileFile + truncateMobileFilePreview): the host
//   reads min(size, 512 KiB + 1) bytes and reports the byteLength of THAT buffer, so a cut file
//   always says about 524289, whatever its real size.
// - files.readTerminalArtifact on a .pdf: isMobileBinaryPath -> 'binary_file'.
// - files.readTerminalArtifactPreview on a .pdf: RUNTIME_PREVIEWABLE_BINARY_MIME_TYPES has
//   '.pdf': 'application/pdf', so the whole file comes back base64 up to 10 MB.
// - files.readPreview on an SSH worktree: size <= 10 MB, then the relay's readRelayFileContent,
//   which returns text whole up to MAX_TEXT_FILE_SIZE (10 MB) and a .pdf whole as base64.
// - files.read on an SSH worktree over 512 KiB: 'file_too_large'.
// - isBinaryBuffer (host and relay) looks at the first 8 KB only.

function ok(result: unknown): RpcSuccess {
  return { id: '1', ok: true, result, _meta: { runtimeId: 'runtime-1' } }
}

function fail(message: string, code = 'error'): RpcFailure {
  return { id: '1', ok: false, error: { code, message }, _meta: { runtimeId: 'runtime-1' } }
}

function host(handlers: Record<string, (params: Record<string, unknown>) => RpcResponse>) {
  const sendRequest = vi.fn(async (method: string, params: Record<string, unknown>) => {
    const handler = handlers[method]
    return handler ? handler(params) : fail(`unexpected ${method}`)
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

const MOBILE_FILE_READ_MAX_BYTES = 512 * 1024
const SSH_CHUNK_REFUSAL = () =>
  fail('SSH runtime chunked download is unavailable; use the SSH download path')

describe('a refusal names only sizes the desktop really reported', () => {
  it('does not tell the user a 5 MB file is 512 KB when it refuses it', async () => {
    // A host whose mobile allowlist has no files.readChunk yet, so the save falls back to files.read.
    const realSize = 5 * 1024 * 1024
    const read = Buffer.alloc(Math.min(realSize, MOBILE_FILE_READ_MAX_BYTES + 1), 0x61)
    const desktop = host({
      'files.readChunk': () => fail('method files.readChunk is not available to mobile clients'),
      'files.read': () =>
        ok({
          worktree: 'wt-1',
          relativePath: 'logs/server.log',
          content: read.subarray(0, MOBILE_FILE_READ_MAX_BYTES).toString('utf8'),
          truncated: true,
          // truncateMobileFilePreview's byteLength: the length of what it read, not of the file.
          byteLength: read.length
        })
    })
    const { target } = phone()

    const outcome = await saveDesktopFileToPhone(
      desktop,
      { source: { source: 'worktree', worktreeId: 'wt-1', relativePath: 'logs/server.log' } },
      target
    )

    expect(outcome).toEqual({
      status: 'refused',
      fileName: 'server.log',
      message: "Can't save server.log: the desktop sends only the first 512 KB of it"
    })
    expect(target.createDocument).not.toHaveBeenCalled()
  })
})

describe('files the desktop does send whole are saved, not refused', () => {
  it('saves a PDF outside the workspace, which the grant preview read sends whole', async () => {
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n')
    const desktop = host({
      'files.readTerminalArtifact': () => fail('binary_file', 'binary_file'),
      'files.readTerminalArtifactPreview': () =>
        ok({
          content: pdf.toString('base64'),
          isBinary: true,
          isImage: true,
          mimeType: 'application/pdf'
        })
    })
    const { target, written } = phone()

    const outcome = await saveDesktopFileToPhone(
      desktop,
      {
        source: {
          source: 'terminalArtifact',
          worktreeId: 'wt-1',
          absolutePath: '/tmp/agent/report.pdf',
          grantId: 'grant-1'
        }
      },
      target
    )

    expect(outcome).toEqual({ status: 'saved', fileName: 'report.pdf', byteLength: pdf.length })
    expect(written.get('content://downloads/document/7')).toBe(pdf.toString('base64'))
  })

  it('saves a PDF from an SSH worktree, which the preview read sends whole', async () => {
    const pdf = Buffer.from('%PDF-1.4\n%%EOF\n')
    const desktop = host({
      'files.readChunk': SSH_CHUNK_REFUSAL,
      'files.read': () => fail('binary_file', 'binary_file'),
      'files.readPreview': () =>
        ok({
          content: pdf.toString('base64'),
          isBinary: true,
          isImage: true,
          mimeType: 'application/pdf'
        })
    })
    const { target, written } = phone()

    const outcome = await saveDesktopFileToPhone(
      desktop,
      { source: { source: 'worktree', worktreeId: 'wt-ssh', relativePath: 'out/paper.pdf' } },
      target
    )

    expect(outcome).toEqual({ status: 'saved', fileName: 'paper.pdf', byteLength: pdf.length })
    expect(written.get('content://downloads/document/7')).toBe(pdf.toString('base64'))
  })

  it('saves a 600 KB text file from an SSH worktree, which the preview read sends whole', async () => {
    const text = 'line of a log\n'.repeat(Math.ceil((600 * 1024) / 14))
    const desktop = host({
      'files.readChunk': SSH_CHUNK_REFUSAL,
      'files.read': () => fail('file_too_large', 'file_too_large'),
      'files.readPreview': () => ok({ content: text, isBinary: false })
    })
    const { target, written } = phone()

    const outcome = await saveDesktopFileToPhone(
      desktop,
      { source: { source: 'worktree', worktreeId: 'wt-ssh', relativePath: 'logs/run.log' } },
      target
    )

    expect(outcome).toMatchObject({ status: 'saved', byteLength: Buffer.byteLength(text) })
    expect(
      Buffer.from(written.get('content://downloads/document/7') ?? '', 'base64').toString('utf8')
    ).toBe(text)
  })

  it('still refuses text the preview read will not send whole either', async () => {
    // A local host with no chunked read: its files.readPreview refuses text over 512 KiB too.
    const desktop = host({
      'files.readChunk': () => fail('method files.readChunk is not available to mobile clients'),
      'files.read': () =>
        ok({ content: 'x'.repeat(64), truncated: true, byteLength: MOBILE_FILE_READ_MAX_BYTES + 1 }),
      'files.readPreview': () => fail('file_too_large', 'file_too_large')
    })
    const { target } = phone()

    const outcome = await saveDesktopFileToPhone(
      desktop,
      { source: { source: 'worktree', worktreeId: 'wt-1', relativePath: 'logs/big.log' } },
      target
    )

    expect(outcome).toEqual({
      status: 'refused',
      fileName: 'big.log',
      message: "Can't save big.log: the desktop sends only the first 512 KB of it"
    })
    expect(target.createDocument).not.toHaveBeenCalled()
  })

  it('names the 10 MB cap when an SSH worktree sends the text neither way', async () => {
    const desktop = host({
      'files.readChunk': SSH_CHUNK_REFUSAL,
      'files.read': () => fail('file_too_large', 'file_too_large'),
      'files.readPreview': () => fail('file_too_large', 'file_too_large')
    })
    const { target } = phone()

    const outcome = await saveDesktopFileToPhone(
      desktop,
      { source: { source: 'worktree', worktreeId: 'wt-ssh', relativePath: 'logs/huge.log' } },
      target
    )

    expect(outcome).toEqual({
      status: 'refused',
      fileName: 'huge.log',
      message: "Can't save huge.log: it is larger than the 10 MB the desktop sends of this file"
    })
  })

  it('refuses a binary the preview read gives no bytes for', async () => {
    const desktop = host({
      'files.readChunk': SSH_CHUNK_REFUSAL,
      'files.read': () => fail('file_too_large', 'file_too_large'),
      'files.readPreview': () => ok({ content: '', isBinary: true })
    })
    const { target } = phone()

    const outcome = await saveDesktopFileToPhone(
      desktop,
      { source: { source: 'worktree', worktreeId: 'wt-ssh', relativePath: 'build/app.out' } },
      target
    )

    expect(outcome).toMatchObject({ status: 'refused' })
    expect(target.createDocument).not.toHaveBeenCalled()
  })

  it('saves text whose NUL byte sits past the 8 KB the desktop checks, byte for byte', async () => {
    // The desktop said text (no binary_file), so this came back decoded. A NUL decodes to U+0000
    // and encodes back to 0x00: nothing was lost in the decoding.
    const bytes = Buffer.concat([
      Buffer.alloc(9000, 0x61),
      Buffer.from([0x00]),
      Buffer.from('tail\n')
    ])
    const desktop = host({
      'files.readChunk': SSH_CHUNK_REFUSAL,
      'files.read': () =>
        ok({ content: bytes.toString('utf8'), truncated: false, byteLength: bytes.length })
    })
    const { target, written } = phone()

    const outcome = await saveDesktopFileToPhone(
      desktop,
      { source: { source: 'worktree', worktreeId: 'wt-ssh', relativePath: 'data/records.txt' } },
      target
    )

    expect(outcome).toMatchObject({ status: 'saved', byteLength: bytes.length })
    expect(
      Buffer.from(written.get('content://downloads/document/7') ?? '', 'base64').equals(bytes)
    ).toBe(true)
  })
})
