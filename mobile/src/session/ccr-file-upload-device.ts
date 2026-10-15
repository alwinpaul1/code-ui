import * as FileSystem from 'expo-file-system/legacy'
import { acquireCcrLink, ccrAccountAuth } from './ccr-link-registry'
import { CCR_UPLOAD_FAILED, CcrFileUploadError, deleteCcrFile, uploadCcrFile, type CcrFileUploadRequest, type CcrUploadedFile } from './ccr-file-upload'

/**
 * The device side of ccr-file-upload.ts: the bytes go into a cache file named as the file is, and
 * expo-file-system sends that file as the multipart part `file`, with the request's other fields
 * and headers (its multipart upload names the part after the file it reads). The cache file is
 * deleted once the request settles, whatever the outcome. An abort cancels the upload task.
 */

let uploads = 0

async function sendMultipart(request: CcrFileUploadRequest, signal?: AbortSignal): Promise<{ status: number; body: string }> {
  uploads += 1
  const dir = `${FileSystem.cacheDirectory ?? ''}ccr-uploads/${Date.now()}-${uploads}/`
  const safeName = [...request.part.fileName].map((char) => (char.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(char) ? '_' : char)).join('').slice(-120) || 'file'
  const fileUri = `${dir}${safeName}`
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true })
  let task: FileSystem.UploadTask | null = null
  const cancel = (): void => void task?.cancelAsync().catch(() => undefined)
  try {
    await FileSystem.writeAsStringAsync(fileUri, request.part.base64, { encoding: FileSystem.EncodingType.Base64 })
    if (signal?.aborted) {
      throw new CcrFileUploadError(CCR_UPLOAD_FAILED, 'cancelled')
    }
    task = FileSystem.createUploadTask(request.url, fileUri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: request.part.field,
      mimeType: request.part.mimeType,
      parameters: { ...request.fields },
      headers: { ...request.headers }
    })
    signal?.addEventListener('abort', cancel)
    const result = await task.uploadAsync()
    if (!result) {
      throw new CcrFileUploadError(CCR_UPLOAD_FAILED, 'cancelled')
    }
    return { status: result.status, body: result.body }
  } finally {
    signal?.removeEventListener('abort', cancel)
    await FileSystem.deleteAsync(dir, { idempotent: true }).catch(() => undefined)
  }
}

/** Uploads one attachment to Anthropic with the sign-in of `accountId`, the account the tab's own
 *  session belongs to (ccrSendTargetForTab). `signal` cancels it. */
export async function uploadCcrFileForSession(accountId: string, sessionId: string, file: { base64: string; name?: string | null; mimeType?: string | null }, signal?: AbortSignal): Promise<CcrUploadedFile> {
  const held = acquireCcrLink(accountId, sessionId)
  try {
    return await held.link.withSession((deps, account) => uploadCcrFile({ auth: deps.auth, upload: sendMultipart }, account, file, signal))
  } finally {
    held.release()
  }
}

/** Deletes an uploaded file no chip references any more, with the account that uploaded it; the
 *  HTTP status (ccr-file-discard.ts logs it). */
export function deleteCcrFileOnDevice(file: CcrUploadedFile): Promise<number> {
  return deleteCcrFile(
    {
      auth: ccrAccountAuth,
      remove: async (request) => ({ status: (await fetch(request.url, { method: 'DELETE', headers: { ...request.headers } })).status })
    },
    file.accountId,
    file.fileId
  )
}
