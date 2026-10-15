import { CCR_API_BASE_URL, CCR_ANTHROPIC_VERSION, CcrApiError } from './ccr-session-api'
import { withAccountAuth, type CcrFileAttachment } from './ccr-send'
import type { CcrLinkDeps } from './ccr-session-link-types'

/**
 * A Claude tab's attachment, uploaded to Anthropic the moment it is attached, as the Claude app
 * does, instead of to a temp file on the desktop (the user, 2026-10-15: "for uploading images docs
 * or any attachment its directly uploaded to anthropic same like claude mobile does not to desktop
 * terminal").
 *
 * The app (1.261009.20) uploads a Code-session attachment with `qnv` ("SessionUploader") to
 * claude.ai's `POST {organization}/upload`, multipart part `file` (`sv5.a`), and its send carries
 * `file_attachments: [{file_uuid, file_name, is_image}]` (`StdinMessage.SdkUserMessage`,
 * `phx`/`rhx`; `SessionFileAttachment`, `u7v`/`w7v`). That route takes the app's own claude.ai
 * login. What the phone holds is Claude Code's sign-in, and the upload Claude Code itself makes
 * with that sign-in is the Files API: `POST {api}/v1/files`, multipart `file` plus
 * `purpose=user_data`, `anthropic-beta: files-api-2025-04-14,oauth-2025-04-20`, reply `{id}`
 * (Claude Code 2.1.300, `tgo`). A probe of 2026-10-15 (P2) got a 200 and an id of the shape
 * `file_…` from it.
 *
 * The desktop reads a `file_attachments` entry with its own token from
 * `GET {api}/api/oauth/files/{file_uuid}/content` (2.1.300, `ze`); its schema takes any string as
 * `file_uuid`. Whether that route serves a Files API id is NOT yet shown: the probe
 * `scratchpad/probe/p13-attachments.cjs` answers it. Until it does, the switch below stays off and
 * a Claude tab's attachments keep going through the desktop terminal, so nothing the user attaches
 * can be posted as a reference the desktop then cannot open.
 *
 * Pure of React Native and Expo: the device layer (ccr-file-upload-device.ts) hands in the upload.
 * Nothing here logs or returns a token.
 */

/** THE switch. On: a Claude tab on the Anthropic lane uploads every attachment to Anthropic and
 *  sends it as `file_attachments`. Off: those tabs keep the desktop terminal path for attachments
 *  (text still goes through Anthropic). Turn on only once P13 shows the desktop reads the file. */
export const CCR_ATTACHMENTS_THROUGH_ANTHROPIC = false

export const CCR_FILES_URL = `${CCR_API_BASE_URL}/v1/files`
export const CCR_FILES_BETA = 'files-api-2025-04-14,oauth-2025-04-20'

/**
 * The largest file the phone sends. The desktop's own download stops at 36 700 160 bytes
 * (35 MiB, Claude Code 2.1.300 `ye`, failure `too_large`), and the app's session upload refuses
 * past `mobile_upload_config.max_file_size_bytes`, 31 457 280 by default (`yy00`, checked in `y5k`
 * against `n430.m(config).f`, chip state `qj4`); the smaller one wins.
 */
export const CCR_ATTACHMENT_MAX_BYTES = 31_457_280

/** The app's `chat_input_file_too_large`, with its number filled in. */
export const CCR_ATTACHMENT_TOO_LARGE = `File size exceeds ${Math.round(CCR_ATTACHMENT_MAX_BYTES / (1024 * 1024))} MB limit`
/** The app's `ccr_upload_failed`. */
export const CCR_UPLOAD_FAILED = 'Upload failed'
/** Nothing in the file: the app has no string for it; this one says what happened. */
export const CCR_ATTACHMENT_EMPTY = 'Upload failed: the file is empty'

/** What one attachment becomes once Anthropic holds it. `accountId` is whose sign-in uploaded it:
 *  only a session of that same account can read it back. */
export type CcrUploadedFile = {
  readonly fileId: string
  readonly fileName: string
  readonly isImage: boolean
  readonly accountId: string
}

export function ccrFileAttachment(file: CcrUploadedFile): CcrFileAttachment {
  return { file_uuid: file.fileId, file_name: file.fileName, is_image: file.isImage }
}

/** The multipart request one upload makes, handed to the device layer as data. */
export type CcrFileUploadRequest = {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  /** The multipart file part: always named `file`. */
  readonly part: { readonly field: 'file'; readonly fileName: string; readonly mimeType: string; readonly base64: string }
  readonly fields: Readonly<Record<string, string>>
}

export type CcrFileUploadDeps = Pick<CcrLinkDeps, 'auth'> & {
  /** Sends the multipart request; the HTTP status and the body as text, whatever they are. Stops
   *  the request when `signal` aborts (the chip was removed, or the lane went away). */
  upload: (request: CcrFileUploadRequest, signal?: AbortSignal) => Promise<{ status: number; body: string }>
}

/** An upload that failed, with the line the chip's toast shows. */
export class CcrFileUploadError extends Error {
  constructor(
    readonly userMessage: string,
    readonly detail: string,
    /** Refused on the phone (empty, over the cap): nothing went out, and a retry cannot help. */
    readonly refusedBeforeUpload = false
  ) {
    super(`${userMessage} (${detail})`)
    this.name = 'CcrFileUploadError'
  }
}

/** The size of what a base64 string decodes to, without decoding it. */
export function base64ByteLength(base64: string): number {
  const body = base64.replace(/^data:[^,]*,/, '').replace(/\s/g, '')
  if (body.length === 0) {
    return 0
  }
  const padding = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0
  return Math.floor((body.length * 3) / 4) - padding
}

const SNIFFED: readonly (readonly [string, string, string])[] = [
  ['iVBORw0KGgo', 'image/png', 'png'],
  ['/9j/', 'image/jpeg', 'jpg'],
  ['R0lGOD', 'image/gif', 'gif'],
  ['UklGR', 'image/webp', 'webp'],
  ['JVBERi0', 'application/pdf', 'pdf']
]

/** The file's type: the picker's word when it gave one, else read off its first bytes. */
export function ccrAttachmentMimeType(base64: string, given?: string | null): string {
  if (given && given.includes('/')) {
    return given
  }
  const body = base64.replace(/^data:[^,]*,/, '')
  return SNIFFED.find(([magic]) => body.startsWith(magic))?.[1] ?? 'application/octet-stream'
}

/** The app's `a3m.a(mime)`: an image is sent with `is_image: true` and the desktop inlines it. */
export function ccrAttachmentIsImage(mimeType: string): boolean {
  return /^image\/(png|jpe?g|gif|webp)$/i.test(mimeType)
}

/** The name the file goes up under: the picker's, else one made from its type (a photo has none). */
export function ccrAttachmentFileName(name: string | null | undefined, mimeType: string): string {
  const given = (name ?? '').trim()
  if (given) {
    return given
  }
  const ext = SNIFFED.find(([, mime]) => mime === mimeType)?.[2] ?? 'bin'
  return ext === 'png' || ext === 'jpg' || ext === 'gif' || ext === 'webp' ? `image.${ext}` : `file.${ext}`
}

/** Why this file must not go up, in the app's words, or null when it may. */
export function ccrAttachmentRefusal(byteLength: number): string | null {
  if (byteLength <= 0) {
    return CCR_ATTACHMENT_EMPTY
  }
  if (byteLength > CCR_ATTACHMENT_MAX_BYTES) {
    return CCR_ATTACHMENT_TOO_LARGE
  }
  return null
}

/** The request, as Claude Code's own Files API upload makes it, with `token`'s sign-in. */
export function ccrFileUploadRequest(token: string, file: { base64: string; fileName: string; mimeType: string }): CcrFileUploadRequest {
  return {
    url: CCR_FILES_URL,
    headers: { Authorization: `Bearer ${token}`, 'anthropic-version': CCR_ANTHROPIC_VERSION, 'anthropic-beta': CCR_FILES_BETA },
    part: { field: 'file', fileName: file.fileName, mimeType: file.mimeType, base64: file.base64.replace(/^data:[^,]*,/, '') },
    fields: { purpose: 'user_data' }
  }
}

function idOf(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body)
    const id = parsed && typeof parsed === 'object' ? (parsed as { id?: unknown }).id : null
    return typeof id === 'string' && /^[A-Za-z0-9_-]{4,200}$/.test(id) ? id : null
  } catch {
    return null
  }
}

/**
 * Uploads one attachment with `accountId`'s own sign-in (the tab's send target: ccrSendTargetForTab
 * names it, never another copy of the session) and returns what the send references. A 401 reads
 * the sign-in again once, as every other call on this lane does. Refuses an empty file and one past
 * the cap before any request goes out. `signal` cancels it (nothing goes out once it has aborted).
 */
export async function uploadCcrFile(deps: CcrFileUploadDeps, accountId: string, file: { base64: string; name?: string | null; mimeType?: string | null }, signal?: AbortSignal): Promise<CcrUploadedFile> {
  const refusal = ccrAttachmentRefusal(base64ByteLength(file.base64))
  if (refusal) {
    throw new CcrFileUploadError(refusal, 'refused before upload', true)
  }
  const mimeType = ccrAttachmentMimeType(file.base64, file.mimeType)
  const fileName = ccrAttachmentFileName(file.name, mimeType)
  let fileId: string
  try {
    fileId = await withAccountAuth(deps, accountId, async (auth) => {
      if (signal?.aborted) {
        throw new CcrFileUploadError(CCR_UPLOAD_FAILED, 'cancelled')
      }
      const response = await deps.upload(ccrFileUploadRequest(auth.token, { base64: file.base64, fileName, mimeType }), signal)
      if (response.status === 401) {
        throw new CcrApiError('files', 'unauthorized', 401)
      }
      if (response.status === 413) {
        throw new CcrFileUploadError(CCR_ATTACHMENT_TOO_LARGE, 'HTTP 413')
      }
      if (response.status < 200 || response.status >= 300) {
        throw new CcrFileUploadError(CCR_UPLOAD_FAILED, `HTTP ${response.status}`)
      }
      const id = idOf(response.body)
      if (!id) {
        throw new CcrFileUploadError(CCR_UPLOAD_FAILED, 'no file id in the reply')
      }
      return id
    })
  } catch (error) {
    if (error instanceof CcrFileUploadError) {
      throw error
    }
    throw new CcrFileUploadError(CCR_UPLOAD_FAILED, error instanceof Error ? error.message : String(error))
  }
  return { fileId, fileName, isImage: ccrAttachmentIsImage(mimeType), accountId }
}

export type CcrFileDeleteDeps = Pick<CcrLinkDeps, 'auth'> & {
  /** Sends the DELETE; the HTTP status, whatever it is. */
  remove: (request: { readonly url: string; readonly headers: Readonly<Record<string, string>> }) => Promise<{ status: number }>
}

/**
 * Deletes a file this phone uploaded and no chip references any more (removed, or landed after its
 * chip was removed), with the sign-in of the account that uploaded it: the Files API's
 * `DELETE /v1/files/{id}`. Resolves with the HTTP status; a 401 reads the sign-in again once.
 */
export async function deleteCcrFile(deps: CcrFileDeleteDeps, accountId: string, fileId: string): Promise<number> {
  return withAccountAuth(deps, accountId, async (auth) => {
    const response = await deps.remove({
      url: `${CCR_FILES_URL}/${encodeURIComponent(fileId)}`,
      headers: { Authorization: `Bearer ${auth.token}`, 'anthropic-version': CCR_ANTHROPIC_VERSION, 'anthropic-beta': CCR_FILES_BETA }
    })
    if (response.status === 401) {
      throw new CcrApiError('files', 'unauthorized', 401)
    }
    return response.status
  })
}
