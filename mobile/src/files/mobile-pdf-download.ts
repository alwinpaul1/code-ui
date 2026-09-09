// Pure: no React Native or Expo imports, so vitest can run it unmocked.
export type MobilePdfDownloadDeps = {
  /** Ask the OS where to save; resolves the writable target URI, or null when
   *  the user backed out. */
  createDocument: (suggestedName: string) => Promise<string | null>
  readBase64: (uri: string) => Promise<string>
  writeBase64: (targetUri: string, base64: string) => Promise<void>
}

export type MobilePdfDownloadOutcome = 'saved' | 'cancelled' | 'failed'

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
 * system picker (defaulting to Downloads) and hands back a content URI the
 * legacy file-system API can write through. The viewer already holds the PDF
 * as a cache file (or, when the cache was unavailable, a data URI), so no
 * second round trip to the desktop is needed.
 */
export async function downloadMobilePdf(
  input: { uri: string; fileName: string },
  deps: MobilePdfDownloadDeps
): Promise<MobilePdfDownloadOutcome> {
  try {
    const target = await deps.createDocument(suggestedPdfFileName(input.fileName))
    if (!target) {
      return 'cancelled'
    }
    const base64 = DATA_URI_PREFIX.test(input.uri)
      ? input.uri.replace(DATA_URI_PREFIX, '')
      : await deps.readBase64(input.uri)
    await deps.writeBase64(target, base64)
    return 'saved'
  } catch {
    return 'failed'
  }
}
