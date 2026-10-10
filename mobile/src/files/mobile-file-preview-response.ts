import type { MobileFileMedia } from './mobile-file-media'
import { classifyMobileArtifact } from '../session/mobile-artifact-kind'
import { cutWholeCharacters } from '../text/whole-character-cut'
import type { RpcFailure } from '../transport/types'
import { isMarkdownPath } from './file-tree'
import { refusalMissingSubject } from './refusal-missing-subject'
import { isTerminalArtifactGrantError } from './terminal-artifact-grant-error'

export type MobileFilePreviewTextKind = 'html' | 'markdown' | 'text'

export type MobileFilePreviewResult =
  | { status: 'ready'; kind: 'media'; media: MobileFileMedia }
  | {
      status: 'loading'
      message: string
    }
  | {
      status: 'waiting'
      message: string
      reconnect: true
    }
  | {
      status: 'ready'
      kind: 'image'
      dataUri: string
    }
  | {
      status: 'ready'
      kind: 'pdf'
      uri: string
    }
  | {
      status: 'ready'
      kind: MobileFilePreviewTextKind
      content: string
      truncated: boolean
      byteLength: number
    }
  | {
      status: 'empty'
      kind: MobileFilePreviewTextKind
    }
  | {
      status: 'error'
      message: string
      reconnect: boolean
    }

/** The accepted arm, for a call site whose acceptance policy already admitted the payload. */
export function normalizeMobileFilePreviewResult(
  relativePath: string,
  result: unknown
): MobileFilePreviewResult {
  const artifactKind = classifyMobileArtifact(relativePath)
  if (artifactKind === 'image') {
    return normalizeImagePreviewResult(result)
  }
  if (artifactKind === 'pdf') {
    return normalizePdfPreviewResult(result)
  }
  return normalizeTextPreviewResult(relativePath, result)
}

/** The refused arm. The code is the fallback copy, and it names what a "not found" is about
 *  (`selector_not_found` is not the file), which is why the refusal itself is needed. */
export function previewErrorFromRefusal(error: RpcFailure['error']): MobileFilePreviewResult {
  return previewErrorFor(error.message || error.code, error.code)
}

const BINARY_PREVIEW_UNAVAILABLE = 'Binary preview unavailable'
const FILE_TOO_LARGE = 'File too large for mobile preview'
const FILE_NOT_FOUND = 'File not found'

/** The copy `previewError` gives the refusals that are the FILE's own answer, and nothing else. */
const FILE_OWN_ERRORS: ReadonlySet<string> = new Set([
  BINARY_PREVIEW_UNAVAILABLE,
  FILE_TOO_LARGE,
  FILE_NOT_FOUND
])

/**
 * Whether an error is the file's own answer: it is not there, too large for the phone, or binary.
 * "Not there" is 'File not found', which a refusal gets only when it names the FILE as missing
 * (`refusalMissingSubject`): a worktree, runtime or method not found is the generic copy below.
 * A caller that keeps a read (the markdown figure resolver) keeps these and nothing else that
 * failed. A positive list on purpose: a refusal about the link or the runtime, a stale grant, and
 * the generic 'Unable to load preview: ...' for a cause this build has not seen are all outside it,
 * so a new wording costs one more read, where the rule this replaced (four recoverable phrases)
 * kept "Remote Orca runtime is not connected." as the file's answer (review 2026-09-30, round 3).
 * `reconnect` still drives the preview screen and is untouched by this.
 */
export function isFileOwnPreviewError(result: MobileFilePreviewResult): boolean {
  return result.status === 'error' && !result.reconnect && FILE_OWN_ERRORS.has(result.message)
}

export function previewError(message: string): MobileFilePreviewResult {
  return previewErrorFor(message, '')
}

function previewErrorFor(message: string, code: string): MobileFilePreviewResult {
  const normalized = message.toLowerCase()
  if (normalized === 'binary_file' || normalized.includes('binary_file')) {
    return { status: 'error', message: BINARY_PREVIEW_UNAVAILABLE, reconnect: false }
  }
  if (normalized === 'file_too_large' || normalized.includes('file_too_large')) {
    return { status: 'error', message: FILE_TOO_LARGE, reconnect: false }
  }
  if (isTerminalArtifactGrantError(normalized)) {
    return { status: 'error', message: 'Reload preview before saving', reconnect: false }
  }
  if (
    normalized.includes('remote connection dropped') ||
    normalized.includes('provider unavailable') ||
    normalized.includes('disconnected') ||
    normalized.includes('reconnect the ssh target')
  ) {
    return { status: 'error', message: 'Unable to reach the desktop filesystem', reconnect: true }
  }
  // Only when it is the FILE that is missing: "Worktree not found", "Remote Orca runtime not
  // found" and `method_not_found` are about the desktop, and fall to the generic copy below.
  if (refusalMissingSubject(code, message) === 'file') {
    return { status: 'error', message: FILE_NOT_FOUND, reconnect: false }
  }
  // Why: the raw text is the only clue when a new read path fails on a host
  // this build was not tested against; keep it visible instead of a blank label.
  // Cut whole characters only: half an emoji from a path drew a broken glyph.
  const detail = cutWholeCharacters(message.trim(), 140)
  const generic = detail.length === 0 || normalized === 'unable to load preview'
  return {
    status: 'error',
    message: generic ? 'Unable to load preview' : `Unable to load preview: ${detail}`,
    reconnect: false
  }
}

/**
 * How much of a text file `files.read` sends before it cuts it and says `truncated`: 512 KiB
 * (MOBILE_FILE_READ_MAX_BYTES, Orca's src/main/runtime/orca-runtime-files.ts at ac675ded6e). The
 * figure is the desktop's, so the copy names it. Never a cut file's size: the reply's `byteLength`
 * is the length of what the host READ (512 KiB and a byte, truncateMobileFilePreview), and the
 * desktop sends the phone nothing else about the file's size on this path.
 */
export const DESKTOP_TEXT_READ_CAP = '512 KB'

/** "512 B", "4 KB", "1.5 MB". Rounds first and names the unit of what it
 *  rounded to: choosing KB first said "1024 KB" for 1,048,064-1,048,575 bytes
 *  in the preview and the save toast (review, 2026-09-30). No caller reaches
 *  a GiB today (the save is capped at MOBILE_CHUNKED_READ_MAX_BYTES, 80 MiB);
 *  the GB step keeps the MB edge from saying "1024.0 MB" if that moves. */
export function formatPreviewByteLength(byteLength: number): string {
  if (!Number.isFinite(byteLength) || byteLength < 0) {
    return 'unknown size'
  }
  if (byteLength < 1024) {
    return `${byteLength} B`
  }
  const kb = Math.round(byteLength / 1024)
  if (kb < 1024) {
    return `${kb} KB`
  }
  const tenthsMb = Math.round((byteLength * 10) / (1024 * 1024))
  if (tenthsMb < 10240) {
    return `${(tenthsMb / 10).toFixed(1)} MB`
  }
  return `${(Math.round((byteLength * 10) / (1024 * 1024 * 1024)) / 10).toFixed(1)} GB`
}

function normalizeImagePreviewResult(result: unknown): MobileFilePreviewResult {
  if (!result || typeof result !== 'object') {
    return previewError('binary_file')
  }
  const preview = result as {
    content?: unknown
    isBinary?: unknown
    isImage?: unknown
    mimeType?: unknown
  }
  if (
    preview.isBinary !== true ||
    preview.isImage !== true ||
    typeof preview.mimeType !== 'string' ||
    preview.mimeType.length === 0 ||
    typeof preview.content !== 'string' ||
    preview.content.length === 0
  ) {
    return previewError('binary_file')
  }
  return {
    status: 'ready',
    kind: 'image',
    dataUri: `data:${preview.mimeType};base64,${preview.content}`
  }
}

// The host tags a .pdf as binary and streams its bytes base64; whether it also
// flags isImage/mimeType varies by host version, so only the bytes are required.
function normalizePdfPreviewResult(result: unknown): MobileFilePreviewResult {
  if (!result || typeof result !== 'object') {
    return previewError('binary_file')
  }
  const preview = result as { content?: unknown; isBinary?: unknown }
  if (preview.isBinary !== true || typeof preview.content !== 'string' || !preview.content) {
    return previewError('binary_file')
  }
  return { status: 'ready', kind: 'pdf', uri: `data:application/pdf;base64,${preview.content}` }
}

function normalizeTextPreviewResult(
  relativePath: string,
  result: unknown
): MobileFilePreviewResult {
  if (!result || typeof result !== 'object') {
    return previewError('Unable to load preview')
  }
  const preview = result as {
    content?: unknown
    truncated?: unknown
    byteLength?: unknown
    isBinary?: unknown
  }
  if (preview.isBinary === true) {
    return previewError('binary_file')
  }
  if (typeof preview.content !== 'string') {
    return previewError('Unable to load preview')
  }
  const kind = textKindForPreviewPath(relativePath)
  if (preview.content.length === 0) {
    return { status: 'empty', kind }
  }
  return {
    status: 'ready',
    kind,
    content: preview.content,
    truncated: preview.truncated === true,
    byteLength: typeof preview.byteLength === 'number' ? preview.byteLength : preview.content.length
  }
}

function textKindForPreviewPath(relativePath: string): MobileFilePreviewTextKind {
  if (classifyMobileArtifact(relativePath) === 'html') {
    return 'html'
  }
  return isMarkdownPath(relativePath) ? 'markdown' : 'text'
}
