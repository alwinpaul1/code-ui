// Pure: no React Native or Expo imports, so vitest runs it unmocked.

const EXTERNAL_STORAGE_AUTHORITY = 'com.android.externalstorage.documents'
const DOWNLOADS_AUTHORITY = 'com.android.providers.downloads.documents'
const DOCUMENT_URI = /^content:\/\/([^/]+)\/(?:tree\/[^/]+\/)?document\/([^/]+)$/

/**
 * The name a document from Android's create-document picker was made under, when its URI says; null
 * when it does not.
 *
 * The picker offers a name, but the user can change it, and the provider renames it when the folder
 * already holds one (FileUtils.buildUniqueFile: `report (1).pdf`). Only the picker's URI comes back,
 * and a content URI's display name takes a ContentResolver query that nothing installed here makes
 * from JS. So this reads the document ID, where two AOSP providers put the path:
 * - phone storage (ExternalStorageProvider): `primary:Download/report.pdf`, the root and then the
 *   path under it;
 * - Downloads (DownloadsProvider): `raw:/storage/emulated/0/Download/report.pdf`. Its other IDs
 *   (`msf:1000001234`, a bare number) name a row, not a file.
 * Anything else, a cloud provider included, is opaque, and the caller keeps the name it offered.
 * These ID shapes are from the providers' source; the URIs a real picker returns have not been
 * checked on a phone.
 */
export function pickedDocumentName(uri: string): string | null {
  const match = DOCUMENT_URI.exec(uri)
  if (!match) {
    return null
  }
  const [, authority, encodedId] = match
  let documentId: string
  try {
    documentId = decodeURIComponent(encodedId!)
  } catch {
    return null
  }
  const colon = documentId.indexOf(':')
  if (colon === -1) {
    return null
  }
  const kind = documentId.slice(0, colon)
  const path = documentId.slice(colon + 1)
  if (
    authority === EXTERNAL_STORAGE_AUTHORITY ||
    (authority === DOWNLOADS_AUTHORITY && kind === 'raw')
  ) {
    return lastSegment(path)
  }
  return null
}

function lastSegment(path: string): string | null {
  const name = path.split('/').at(-1)?.trim()
  return name ? name : null
}
