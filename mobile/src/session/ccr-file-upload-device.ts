import * as FileSystem from 'expo-file-system/legacy'
import { acquireCcrLink } from './ccr-link-registry'
import { uploadCcrFile, type CcrFileUploadRequest, type CcrUploadedFile } from './ccr-file-upload'

/**
 * The device side of ccr-file-upload.ts: the bytes go into a cache file named as the file is, and
 * expo-file-system sends that file as the multipart part `file`, with the request's other fields
 * and headers (its multipart upload names the part after the file it reads). The cache file is
 * deleted once the request settles, whatever the outcome.
 */

let uploads = 0

async function sendMultipart(request: CcrFileUploadRequest): Promise<{ status: number; body: string }> {
  uploads += 1
  const dir = `${FileSystem.cacheDirectory ?? ''}ccr-uploads/${Date.now()}-${uploads}/`
  const safeName = [...request.part.fileName].map((char) => (char.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(char) ? '_' : char)).join('').slice(-120) || 'file'
  const fileUri = `${dir}${safeName}`
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true })
  try {
    await FileSystem.writeAsStringAsync(fileUri, request.part.base64, { encoding: FileSystem.EncodingType.Base64 })
    const result = await FileSystem.uploadAsync(request.url, fileUri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: request.part.field,
      mimeType: request.part.mimeType,
      parameters: { ...request.fields },
      headers: { ...request.headers }
    })
    return { status: result.status, body: result.body }
  } finally {
    await FileSystem.deleteAsync(dir, { idempotent: true }).catch(() => undefined)
  }
}

/** Uploads one attachment to Anthropic with the sign-in of `accountId`, the account the tab's own
 *  session belongs to (ccrSendTargetForTab). */
export async function uploadCcrFileForSession(accountId: string, sessionId: string, file: { base64: string; name?: string | null; mimeType?: string | null }): Promise<CcrUploadedFile> {
  const held = acquireCcrLink(accountId, sessionId)
  try {
    return await held.link.withSession((deps, account) => uploadCcrFile({ auth: deps.auth, upload: sendMultipart }, account, file))
  } finally {
    held.release()
  }
}
