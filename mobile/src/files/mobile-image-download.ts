// Pure: no React Native or Expo imports, so vitest can run it unmocked.
import { pickedDocumentName } from './android-picked-document-name'
import { PickerGateAbandonedError, withPickerGate, type PickerGateWaiter } from './mobile-picker-gate'
import type { MobilePdfDownloadDeps, MobilePdfDownloadOutcome } from './mobile-pdf-download'

export type MobileImageDownloadDeps = Omit<MobilePdfDownloadDeps, 'createDocument'> & {
  createDocument: (suggestedName: string, mimeType: string) => Promise<string | null>
}
export type MobileImageDownloadOutcome = MobilePdfDownloadOutcome

const DATA_URI = /^data:(image\/[a-z0-9.+-]+);base64,/i
const EXTENSION_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp'
}

/** The picture's type, from a `data:` URI's own header or a file's
 *  extension; PNG when neither says. */
export function imageMimeType(uri: string): string {
  const data = DATA_URI.exec(uri)
  if (data?.[1]) {
    return data[1].toLowerCase()
  }
  const extension = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(uri)?.[1]?.toLowerCase()
  return (extension && EXTENSION_MIME[extension]) || 'image/png'
}

/** `image.png`, `image.jpg`: what the save picker offers. */
export function suggestedImageFileName(mimeType: string): string {
  const subtype = mimeType.split('/')[1] ?? 'png'
  return `image.${subtype === 'jpeg' ? 'jpg' : subtype.replace(/[^a-z0-9]/gi, '') || 'png'}`
}

/**
 * Save the picture the viewer shows where the user chooses: the system "Save
 * to" picker, as the PDF viewer's Download does (mobile-pdf-download.ts says
 * why a picker and not a fixed Downloads path). The viewer already holds the
 * picture as a cache file or a `data:` URI, so nothing goes back to the host.
 */
export async function downloadMobileImage(
  input: { uri: string },
  deps: MobileImageDownloadDeps,
  waiter: PickerGateWaiter = {}
): Promise<MobileImageDownloadOutcome> {
  const mimeType = imageMimeType(input.uri)
  const offeredName = suggestedImageFileName(mimeType)
  let target: string | null = null
  try {
    target = await withPickerGate(() => deps.createDocument(offeredName, mimeType), waiter)
    if (!target) {
      return { status: 'cancelled' }
    }
    const head = DATA_URI.exec(input.uri)
    const base64 = head ? input.uri.slice(head[0].length) : await deps.readBase64(input.uri)
    await deps.writeBase64(target, base64)
    return { status: 'saved' }
  } catch (error) {
    if (error instanceof PickerGateAbandonedError) {
      return { status: 'cancelled' }
    }
    if (target) {
      try {
        await deps.remove(target)
      } catch {
        return { status: 'failed-left-incomplete', fileName: pickedDocumentName(target) ?? offeredName }
      }
    }
    return { status: 'failed' }
  }
}
