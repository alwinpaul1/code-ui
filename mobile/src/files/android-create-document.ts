import * as IntentLauncher from 'expo-intent-launcher'

const ANDROID_CREATE_DOCUMENT = 'android.intent.action.CREATE_DOCUMENT'
const ANDROID_CATEGORY_OPENABLE = 'android.intent.category.OPENABLE'
const ANDROID_EXTRA_TITLE = 'android.intent.extra.TITLE'

/**
 * Android's system "Save to" picker (ACTION_CREATE_DOCUMENT, the Storage Access Framework). It
 * opens on Downloads, lets the user pick any folder and rename the file, and hands back a content
 * URI the legacy file-system API writes through; null when the user backs out. No storage
 * permission: since Android 10 an app has no direct write access to Downloads, and the picker is
 * the sanctioned way in. Proven on device by the PDF viewer's Download button (0.2.86); the file
 * save (mobile-file-save-device.ts) shares it.
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
