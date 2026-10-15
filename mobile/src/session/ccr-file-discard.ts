import type { CcrUploadedFile } from './ccr-file-upload'
import { reasonOf } from './ccr-session-shared'

/**
 * A file this phone uploaded to Anthropic that no chip references any more: its chip was removed
 * once it had landed, or its upload finished after the chip was removed (review of the attachment
 * lane, 2026-10-15). It is deleted, best effort, with the sign-in of the account that uploaded it,
 * and one `[ccr-upload]` line says how that went. Nothing here logs a token: the line names the
 * file id's tail and the HTTP status or the failure.
 *
 * The delete is loaded on first use with `import()`: ccr-file-upload-device.ts pulls in
 * expo-file-system, which the chip strip's own tests cannot load (use-ccr-attachment-lane.ts loads
 * the upload the same way).
 */

type CcrFileDelete = (file: CcrUploadedFile) => Promise<number>

const deleteOnDevice: CcrFileDelete = async (file) => (await import('./ccr-file-upload-device')).deleteCcrFileOnDevice(file)

let remove: CcrFileDelete = deleteOnDevice
let log: (line: string) => void = (line) => console.log(line)

function tail(fileId: string): string {
  return fileId.length > 8 ? `…${fileId.slice(-6)}` : fileId
}

/** Deletes `file` at Anthropic, best effort; resolves once the outcome is logged, never rejects. */
export async function discardCcrUploadedFile(file: CcrUploadedFile | undefined): Promise<void> {
  if (!file) {
    return
  }
  try {
    const status = await remove(file)
    log(`[ccr-upload] attachment ${tail(file.fileId)} no chip references was ${status >= 200 && status < 300 ? 'deleted' : `not deleted (HTTP ${status})`}`)
  } catch (error) {
    log(`[ccr-upload] attachment ${tail(file.fileId)} no chip references could not be deleted: ${reasonOf(error)}`)
  }
}

export function setCcrFileDiscardForTests(next: { remove?: CcrFileDelete; log?: (line: string) => void } | null): void {
  remove = next?.remove ?? deleteOnDevice
  log = next?.log ?? ((line) => console.log(line))
}
