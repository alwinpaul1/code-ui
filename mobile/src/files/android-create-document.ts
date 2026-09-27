import { AppState } from 'react-native'
import { File } from 'expo-file-system'
import * as IntentLauncher from 'expo-intent-launcher'
import { configurePickerGateStaleEscape } from './mobile-picker-gate'

const ANDROID_CREATE_DOCUMENT = 'android.intent.action.CREATE_DOCUMENT'
const ANDROID_CATEGORY_OPENABLE = 'android.intent.category.OPENABLE'
const ANDROID_EXTRA_TITLE = 'android.intent.extra.TITLE'

// A picker's own Activity result can, rarely, never come back to IntentLauncherModule.kt's
// `pendingPromise` (OnActivityResult not delivered for that request code -- the hosting Activity
// recreated under the picker, say). Before mobile-picker-gate.ts's queue existed, that only ever
// stuck the ONE save that opened it; queued behind it instead, every save and PDF Download after
// it would wait forever too. AppState is how the gate tells "still genuinely open" (a real picker
// takes the foreground, so the app itself reads as backgrounded) from "lost" (the app is back in
// front, but nothing ever settled the call that opened it): STALE_ACTIVE_MS is comfortably longer
// than the near-instant resolve a normal return gets.
const STALE_ACTIVE_MS = 4000
const STALE_POLL_MS = 500
configurePickerGateStaleEscape({
  isActive: () => AppState.currentState === 'active',
  activeMs: STALE_ACTIVE_MS,
  pollMs: STALE_POLL_MS
})

/**
 * Android's system "Save to" picker (ACTION_CREATE_DOCUMENT, the Storage Access Framework). It
 * opens on Downloads, lets the user pick any folder and rename the file, and hands back a content
 * URI for the (empty) document it just made; null when the user backs out. No storage permission:
 * since Android 10 an app has no direct write access to Downloads, and the picker is the
 * sanctioned way in. The PDF viewer's Download and the file save (mobile-file-save-device.ts)
 * share it, and write through `writeAndroidDocumentBase64` below.
 */
export async function createAndroidDocument(
  suggestedName: string,
  mimeType: string
): Promise<string | null> {
  const result = await IntentLauncher.startActivityAsync(ANDROID_CREATE_DOCUMENT, {
    type: mimeType,
    category: ANDROID_CATEGORY_OPENABLE,
    extra: { [ANDROID_EXTRA_TITLE]: suggestedName }
  })
  return result.resultCode === IntentLauncher.ResultCode.Success && result.data ? result.data : null
}

/**
 * Writes base64 bytes into a document the picker made.
 *
 * Through expo-file-system's `File`, NOT the legacy module. The legacy writeAsStringAsync and
 * deleteAsync grant WRITE only to a content URI whose host starts with
 * "com.android.externalstorage" (FileSystemLegacyModule.kt `isSAFUri`, 57.0.6); every other
 * content URI is read-only to them. The picker's default root, Downloads, hands back
 * `content://com.android.providers.downloads.documents/document/...`, so a save there threw
 * "isn't writable" and left the empty document behind. `File` treats any documents-provider URI
 * as a SAF document (DocumentsContract.isDocumentUri, FileSystemPath.kt) and writes through
 * contentResolver.openOutputStream, which is what the picker's grant allows.
 *
 * Synchronous on the JS thread, as the PDF cache's own `File.write` is. It replaces what was
 * there; the picker's document is new and empty.
 */
export async function writeAndroidDocumentBase64(uri: string, base64: string): Promise<void> {
  new File(uri).write(base64, { encoding: 'base64' })
}

/** Removes a document the picker made, through the same `File` path as the write (see above).
 *  Throws when the provider will not delete it. */
export async function deleteAndroidDocument(uri: string): Promise<void> {
  new File(uri).delete()
}
