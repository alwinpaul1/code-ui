// Pure: no React Native or Expo imports, so vitest can run it unmocked.
import { pickedDocumentName } from './android-picked-document-name'
import { withPickerGate } from './mobile-picker-gate'

export type MobilePdfDownloadDeps = {
  /** Ask the OS where to save; resolves the writable target URI, or null when
   *  the user backed out. */
  createDocument: (suggestedName: string) => Promise<string | null>
  readBase64: (uri: string) => Promise<string>
  writeBase64: (targetUri: string, base64: string) => Promise<void>
  /** Removes the document the picker made when the write into it failed, so no empty PDF is left
   *  under the name the user chose. When it throws, the outcome says the document is still there. */
  remove: (targetUri: string) => Promise<void>
}

export type MobilePdfDownloadOutcome =
  | { status: 'saved' | 'cancelled' | 'failed' }
  /** The download failed after the picker had made its document, and the document could not be
   *  removed. It is still where the user chose, empty or cut short, and would read as the PDF.
   *  `fileName` is its name there: the one the picker's URI gives (the user may have renamed it),
   *  else the one it was offered under. */
  | { status: 'failed-left-incomplete'; fileName: string }

const DATA_URI_PREFIX = /^data:application\/pdf;base64,/i

/** `docs/out/Report.PDF` → `Report.PDF`; `report` → `report.pdf`. */
export function suggestedPdfFileName(fileName: string): string {
  const segments = fileName.split(/[\\/]/)
  let base = ''
  for (let i = segments.length - 1; i >= 0 && !base; i--) {
    base = segments[i]?.trim() ?? ''
  }
  if (!base) {
    base = 'document'
  }
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`
}

/**
 * Save the previewed PDF where the user chooses.
 *
 * Why a system file picker and not a fixed Downloads path: Android 10+ gives an
 * app no direct write access to Downloads; ACTION_CREATE_DOCUMENT opens the
 * system picker (defaulting to Downloads) and hands back a content URI that
 * expo-file-system's File writes through (android-create-document.ts says why
 * not the legacy API). The viewer already holds the PDF
 * as a cache file (or, when the cache was unavailable, a data URI), so no
 * second round trip to the desktop is needed.
 */
export async function downloadMobilePdf(
  input: { uri: string; fileName: string },
  deps: MobilePdfDownloadDeps
): Promise<MobilePdfDownloadOutcome> {
  const offeredName = suggestedPdfFileName(input.fileName)
  let target: string | null = null
  try {
    // Shared with the file save's runner (mobile-file-save.ts): Android's create-document picker
    // keeps one pending Activity result at a time, so a save reached from another tab or the
    // session's own file could otherwise collide with this one. `withPickerGate` serializes every
    // request, from whichever caller it comes from, so this waits its turn instead.
    target = await withPickerGate(() => deps.createDocument(offeredName))
    if (!target) {
      return { status: 'cancelled' }
    }
    const base64 = DATA_URI_PREFIX.test(input.uri)
      ? input.uri.replace(DATA_URI_PREFIX, '')
      : await deps.readBase64(input.uri)
    await deps.writeBase64(target, base64)
    return { status: 'saved' }
  } catch {
    if (target) {
      try {
        await deps.remove(target)
      } catch {
        return {
          status: 'failed-left-incomplete',
          fileName: pickedDocumentName(target) ?? offeredName
        }
      }
    }
    return { status: 'failed' }
  }
}
