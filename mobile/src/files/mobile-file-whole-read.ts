import { classifyMobileArtifact } from '../session/mobile-artifact-kind'
import type { RpcAcceptedResult } from '../transport/rpc-accepted-result'
import type { RpcFailure, RpcResponse } from '../transport/types'
import {
  MOBILE_CHUNKED_READ_MAX_BYTES,
  readMobileFileBase64Chunked
} from './mobile-file-chunked-read'
import {
  filePreviewImageRead,
  filePreviewTextRead,
  terminalArtifactImageRead,
  terminalArtifactTextRead,
  type MobileFilePreviewRpcSender
} from './mobile-file-preview-operations'
import type { MobileFilePreviewSource } from './mobile-file-preview-request'
import { formatPreviewByteLength } from './mobile-file-preview-response'
import { isAbsoluteTabPath, resolveOutsideWorktree } from './mobile-file-tab-outside-worktree'
import {
  refreshTerminalArtifactSourceAfterGrantFailure,
  type MobileTerminalArtifactPreviewSource
} from './mobile-terminal-artifact-grant-refresh'
import { isTerminalArtifactGrantError } from './terminal-artifact-grant-error'

/**
 * Every whole-file read a save can make, and the one question it answers: did the phone get ALL of
 * the file's bytes? A save never writes a file the desktop cut, so anything short of that is a
 * refusal with its reason, never a partial file.
 *
 * The reads, best first. Figures read off Orca's own source (src/main/runtime/orca-runtime-files.ts
 * at ac675ded6e); they are the desktop's, so the copy names them rather than guessing:
 *   - `files.readChunk`: raw bytes of any file in a LOCAL worktree, 512 KiB a call and no
 *     whole-file cap. The phone stops at MOBILE_CHUNKED_READ_MAX_BYTES. The host refuses it for an
 *     SSH worktree ("SSH runtime chunked download is unavailable").
 *   - `files.readPreview` / `files.readTerminalArtifactPreview`: an image, whole and base64, up to
 *     10 MB (RUNTIME_PREVIEWABLE_BINARY_MAX_BYTES), refused above that.
 *   - `files.read` / `files.readTerminalArtifact`: text decoded as UTF-8, 512 KiB
 *     (MOBILE_FILE_READ_MAX_BYTES). `files.read` cuts and says `truncated`; the artifact read
 *     refuses with file_too_large. A binary extension is refused with binary_file.
 * The capped reads are the only way to a file outside the workspace (through a terminal's grant)
 * and to a file in an SSH worktree.
 */
export type MobileFileSaveSource =
  | MobileFilePreviewSource
  | {
      /** A session file tab: `path` is worktree-relative, or absolute for a file the desktop
       *  opened from outside the worktree, which a terminal here has to vouch for. */
      source: 'fileTab'
      worktreeId: string
      path: string
      terminalHandles: readonly string[]
    }

export type WholeDesktopFileRead =
  | { status: 'read'; base64: string; byteLength: number }
  /** The file cannot come over whole; asking again will not change that. */
  | { status: 'refused'; reason: string }
  | { status: 'failed'; reason: string }

export type WholeDesktopFileReadOptions = {
  maxBytes?: number
  chunkBytes?: number
  onProgress?: (bytesSoFar: number) => void
}

const HOST_TEXT_CAP = '512 KB'
const HOST_IMAGE_CAP = '10 MB'

/** The chunked read is missing on this host or for this worktree; anything else is a real failure
 *  that a capped read would only disguise (a dropped connection read again as "cut at 512 KB"). */
const CHUNKED_READ_UNAVAILABLE =
  /chunked download is unavailable|not available to mobile clients|method_not_found|method not found|forbidden|binary_file/i

export function sourcePath(source: MobileFileSaveSource): string {
  return source.source === 'worktree'
    ? source.relativePath
    : source.source === 'terminalArtifact'
      ? source.absolutePath
      : source.path
}

export async function readWholeDesktopFile(
  client: MobileFilePreviewRpcSender,
  source: MobileFileSaveSource,
  options: WholeDesktopFileReadOptions = {}
): Promise<WholeDesktopFileRead> {
  try {
    const resolved =
      source.source === 'fileTab' ? await resolveFileTabSource(client, source) : source
    return resolved.source === 'worktree'
      ? await readWorktreeFile(client, resolved, options)
      : await readThroughGrant(client, resolved)
  } catch (error) {
    return { status: 'failed', reason: failureReason(error instanceof Error ? error.message : '') }
  }
}

async function resolveFileTabSource(
  client: MobileFilePreviewRpcSender,
  tab: Extract<MobileFileSaveSource, { source: 'fileTab' }>
): Promise<MobileFilePreviewSource> {
  if (!isAbsoluteTabPath(tab.path)) {
    return { source: 'worktree', worktreeId: tab.worktreeId, relativePath: tab.path }
  }
  const outside = await resolveOutsideWorktree(
    client,
    `id:${tab.worktreeId}`,
    tab.path,
    tab.terminalHandles
  )
  const worktreeId = outside.worktree.replace(/^id:/, '')
  return outside.kind === 'grant'
    ? { source: 'terminalArtifact', worktreeId, absolutePath: tab.path, grantId: outside.grantId }
    : { source: 'worktree', worktreeId, relativePath: outside.relativePath }
}

async function readWorktreeFile(
  client: MobileFilePreviewRpcSender,
  source: Extract<MobileFilePreviewSource, { source: 'worktree' }>,
  options: WholeDesktopFileReadOptions
): Promise<WholeDesktopFileRead> {
  const maxBytes = options.maxBytes ?? MOBILE_CHUNKED_READ_MAX_BYTES
  const worktree = `id:${source.worktreeId}`
  try {
    const { base64, byteLength } = await readMobileFileBase64Chunked(
      client,
      worktree,
      source.relativePath,
      {
        maxBytes,
        ...(options.chunkBytes ? { chunkBytes: options.chunkBytes } : {}),
        ...(options.onProgress ? { onProgress: options.onProgress } : {}),
        allowEmpty: true
      }
    )
    return { status: 'read', base64, byteLength }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'file_too_large') {
      return {
        status: 'refused',
        reason: `it is over ${formatPreviewByteLength(maxBytes)}, the most the phone takes from the desktop`
      }
    }
    if (!CHUNKED_READ_UNAVAILABLE.test(message)) {
      return { status: 'failed', reason: failureReason(message) }
    }
  }
  const params = { worktree, relativePath: source.relativePath }
  return classifyMobileArtifact(source.relativePath) === 'image'
    ? imageRead(
        settle(await filePreviewImageRead.request(client, params), filePreviewImageRead.interpret)
      )
    : textRead(
        settle(await filePreviewTextRead.request(client, params), filePreviewTextRead.interpret)
      )
}

async function readThroughGrant(
  client: MobileFilePreviewRpcSender,
  source: MobileTerminalArtifactPreviewSource
): Promise<WholeDesktopFileRead> {
  const image = classifyMobileArtifact(source.absolutePath) === 'image'
  const send = async (grant: MobileTerminalArtifactPreviewSource) => {
    const params = {
      worktree: `id:${grant.worktreeId}`,
      absolutePath: grant.absolutePath,
      grantId: grant.grantId
    }
    return image
      ? settle(
          await terminalArtifactImageRead.request(client, params),
          terminalArtifactImageRead.interpret
        )
      : settle(
          await terminalArtifactTextRead.request(client, params),
          terminalArtifactTextRead.interpret
        )
  }
  let outcome = await send(source)
  if (!outcome.accepted) {
    // A grant lives ten minutes and dies with its terminal; one fresh one is worth asking for.
    const refreshed = await refreshTerminalArtifactSourceAfterGrantFailure(
      client,
      source,
      outcome.refusal
    )
    if (refreshed) {
      outcome = await send(refreshed)
    }
  }
  return image ? imageRead(outcome) : textRead(outcome)
}

type Settled =
  | { accepted: true; value: unknown }
  | { accepted: false; refusal: RpcFailure['error'] }

function settle(
  reply: RpcResponse,
  interpret: (reply: RpcResponse) => RpcAcceptedResult<unknown>
): Settled {
  const verdict = interpret(reply)
  return verdict.accepted
    ? { accepted: true, value: verdict.value }
    : // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: these policies skip only a refusal, so an unaccepted reply is a failure envelope.
      { accepted: false, refusal: (reply as RpcFailure).error }
}

function imageRead(outcome: Settled): WholeDesktopFileRead {
  if (!outcome.accepted) {
    return refusalRead(outcome.refusal, HOST_IMAGE_CAP)
  }
  const preview = outcome.value as { content?: unknown; isImage?: unknown }
  if (preview.isImage !== true || typeof preview.content !== 'string' || !preview.content) {
    return { status: 'refused', reason: PREVIEW_ONLY }
  }
  return { status: 'read', base64: preview.content, byteLength: base64ByteLength(preview.content) }
}

function textRead(outcome: Settled): WholeDesktopFileRead {
  if (!outcome.accepted) {
    return refusalRead(outcome.refusal, HOST_TEXT_CAP)
  }
  const text = outcome.value as { content: string; truncated?: unknown; byteLength?: unknown }
  if (text.truncated === true) {
    const size =
      typeof text.byteLength === 'number'
        ? ` (the file is ${formatPreviewByteLength(text.byteLength)})`
        : ''
    return {
      status: 'refused',
      reason: `the desktop sends only the first ${HOST_TEXT_CAP} of it${size}`
    }
  }
  // Text is decoded on the desktop; a replacement character or a NUL means the bytes it came from
  // were not UTF-8 text, and they cannot be rebuilt from what arrived.
  if (text.content.includes(REPLACEMENT_CHARACTER) || text.content.includes(NUL)) {
    return { status: 'refused', reason: PREVIEW_ONLY }
  }
  const bytes = new TextEncoder().encode(text.content)
  return { status: 'read', base64: bytesToBase64(bytes), byteLength: bytes.length }
}

const PREVIEW_ONLY = 'the desktop sends only a preview of this kind of file, not the file'
const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd)
const NUL = String.fromCharCode(0)

function refusalRead(refusal: RpcFailure['error'], cap: string): WholeDesktopFileRead {
  const text = `${refusal.code} ${refusal.message}`.toLowerCase()
  if (text.includes('file_too_large')) {
    return {
      status: 'refused',
      reason: `it is larger than the ${cap} the desktop sends of this file`
    }
  }
  if (text.includes('binary_file')) {
    return { status: 'refused', reason: PREVIEW_ONLY }
  }
  return { status: 'failed', reason: failureReason(refusal.message || refusal.code) }
}

/** Plain words for the failures that have them; the desktop's own text for the rest, because it is
 *  the only clue a failure on an untested host leaves. */
export function failureReason(message: string): string {
  const normalized = message.toLowerCase()
  if (normalized === 'outside_worktree') {
    return 'the phone can reach a file outside the workspace only while a terminal here still shows its path'
  }
  if (isTerminalArtifactGrantError(normalized)) {
    return 'the desktop no longer lets the phone read it; open it again from the terminal'
  }
  if (
    normalized.includes('enoent') ||
    normalized.includes('no such file') ||
    normalized.includes('not found') ||
    normalized.includes('does not exist')
  ) {
    return 'it is no longer on the desktop'
  }
  if (
    normalized.includes('remote connection dropped') ||
    normalized.includes('provider unavailable') ||
    normalized.includes('disconnected') ||
    normalized.includes('not connected') ||
    normalized.includes('timed out') ||
    normalized.includes('timeout')
  ) {
    return 'the desktop could not be reached'
  }
  const detail = message.trim().slice(0, 140)
  return detail || 'the desktop gave no reason'
}

function base64ByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.floor((base64.length * 3) / 4) - padding
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const step = 0x8000
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + step))
  }
  return btoa(binary)
}
