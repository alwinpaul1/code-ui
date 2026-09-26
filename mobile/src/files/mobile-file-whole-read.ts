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
import { DESKTOP_TEXT_READ_CAP, formatPreviewByteLength } from './mobile-file-preview-response'
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
 *   - `files.readPreview` / `files.readTerminalArtifactPreview`: an image or a PDF, whole and
 *     base64, up to 10 MB (RUNTIME_PREVIEWABLE_BINARY_MAX_BYTES), refused above that. On an SSH
 *     worktree `files.readPreview` also sends TEXT whole up to 10 MB (the relay's
 *     readRelayFileContent, src/relay/fs-handler-file-read.ts); a local host's refuses text past
 *     512 KiB.
 *   - `files.read` / `files.readTerminalArtifact`: text decoded as UTF-8, 512 KiB
 *     (MOBILE_FILE_READ_MAX_BYTES). `files.read` cuts and says `truncated` (an SSH worktree's
 *     refuses with file_too_large instead); the artifact read refuses with file_too_large. A binary
 *     extension, PDFs included, is refused with binary_file.
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
  /** Aborted when nobody is waiting for the file any more; a chunked read stops at its next wave. */
  signal?: AbortSignal
}

const HOST_PREVIEW_CAP = '10 MB'

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
        ...(options.signal ? { signal: options.signal } : {}),
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
  const readPreview = async () =>
    settle(await filePreviewImageRead.request(client, params), filePreviewImageRead.interpret)
  if (sentWholeByPreview(source.relativePath)) {
    return imageRead(await readPreview())
  }
  const capped = settle(
    await filePreviewTextRead.request(client, params),
    filePreviewTextRead.interpret
  )
  if (!cutForSize(capped)) {
    return textRead(capped)
  }
  // Past the capped read's 512 KiB. An SSH worktree's preview read sends text whole up to 10 MB; a
  // local host's refuses it too, and then the capped read's own refusal stands.
  const preview = await readPreview()
  const whole = wholeTextFromPreview(preview)
  if (whole) {
    return whole
  }
  if (!capped.accepted && !preview.accepted && isTooLarge(preview.refusal)) {
    // Both reads refused on size: an SSH worktree, where the preview's 10 MB is the cap that held.
    return refusalRead(preview.refusal, HOST_PREVIEW_CAP)
  }
  return textRead(capped)
}

/** Images and PDFs: the preview reads send these whole, as base64. The text reads refuse a PDF as
 *  binary_file, so a PDF outside the workspace or on an SSH worktree used to be refused. */
function sentWholeByPreview(path: string): boolean {
  const kind = classifyMobileArtifact(path)
  return kind === 'image' || kind === 'pdf'
}

async function readThroughGrant(
  client: MobileFilePreviewRpcSender,
  source: MobileTerminalArtifactPreviewSource
): Promise<WholeDesktopFileRead> {
  const viaPreview = sentWholeByPreview(source.absolutePath)
  const send = async (grant: MobileTerminalArtifactPreviewSource) => {
    const params = {
      worktree: `id:${grant.worktreeId}`,
      absolutePath: grant.absolutePath,
      grantId: grant.grantId
    }
    return viaPreview
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
  return viaPreview ? imageRead(outcome) : textRead(outcome)
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
    return refusalRead(outcome.refusal, HOST_PREVIEW_CAP)
  }
  const preview = outcome.value as { content?: unknown; isImage?: unknown }
  if (preview.isImage !== true || typeof preview.content !== 'string' || !preview.content) {
    return { status: 'refused', reason: PREVIEW_ONLY }
  }
  return { status: 'read', base64: preview.content, byteLength: base64ByteLength(preview.content) }
}

function textRead(outcome: Settled): WholeDesktopFileRead {
  if (!outcome.accepted) {
    return refusalRead(outcome.refusal, DESKTOP_TEXT_READ_CAP)
  }
  const text = outcome.value as { content: string; truncated?: unknown }
  if (text.truncated === true) {
    // No size here: the host's `byteLength` on a cut read is the length of what it READ (512 KiB
    // and a byte, truncateMobileFilePreview), not of the file, so "(the file is 512 KB)" was said
    // of every file over the cap. The desktop never tells the phone the real size on this path.
    return {
      status: 'refused',
      reason: `the desktop sends only the first ${DESKTOP_TEXT_READ_CAP} of it`
    }
  }
  return decodedTextRead(text.content)
}

/** The capped read cut the text or refused it for its size. */
function cutForSize(outcome: Settled): boolean {
  return outcome.accepted
    ? (outcome.value as { truncated?: unknown }).truncated === true
    : isTooLarge(outcome.refusal)
}

/** What the preview read sent for text the capped read would not send whole; null when it did not
 *  send it either (a local host's preview read refuses text past 512 KiB, an old host has none). */
function wholeTextFromPreview(outcome: Settled): WholeDesktopFileRead | null {
  if (!outcome.accepted) {
    return null
  }
  const preview = outcome.value as { content?: unknown; isBinary?: unknown; isImage?: unknown }
  if (typeof preview.content !== 'string') {
    return null
  }
  if (preview.isImage === true) {
    return imageRead(outcome)
  }
  if (preview.isBinary === true) {
    return { status: 'refused', reason: PREVIEW_ONLY }
  }
  return decodedTextRead(preview.content)
}

/**
 * Text the desktop decoded as UTF-8, back to its bytes. A replacement character means the bytes it
 * came from were not UTF-8, and they cannot be rebuilt from what arrived. A NUL is no such sign: it
 * decodes to U+0000 and encodes back to 0x00. The desktop refuses a file as binary only on a NUL in
 * its first 8 KB, so text with one later came back as text and is saved as it is.
 */
function decodedTextRead(content: string): WholeDesktopFileRead {
  if (content.includes(REPLACEMENT_CHARACTER)) {
    return { status: 'refused', reason: PREVIEW_ONLY }
  }
  const bytes = new TextEncoder().encode(content)
  return { status: 'read', base64: bytesToBase64(bytes), byteLength: bytes.length }
}

const PREVIEW_ONLY = 'the desktop sends only a preview of this kind of file, not the file'
const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd)

function isTooLarge(refusal: RpcFailure['error']): boolean {
  return `${refusal.code} ${refusal.message}`.toLowerCase().includes('file_too_large')
}

function refusalRead(refusal: RpcFailure['error'], cap: string): WholeDesktopFileRead {
  const text = `${refusal.code} ${refusal.message}`.toLowerCase()
  if (isTooLarge(refusal)) {
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
