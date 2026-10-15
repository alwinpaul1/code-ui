import * as FileSystem from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'
import { Alert } from 'react-native'
import { fetchAccountCredentials } from '../dictation/anthropic-credential-reader'
import { withPickerGate } from '../files/mobile-picker-gate'
import { ccrAttachmentMime, fetchCcrAttachment, type CcrAttachmentDeps, type CcrAttachmentOutcome } from './ccr-attachment-fetch'
import type { CcrAttachmentRef } from './mobile-native-chat-file-mentions'

/**
 * The device side of an attachment card (ccr-attachment-fetch.ts has the rules): the file comes
 * down into the app's cache once per file uuid and a tap hands it to Android's viewer, as the
 * APK installer is handed its file (app-update/android-apk-install.ts). Loaded with `import()` by
 * the card (MobileNativeChatFileCard.tsx), so the chat does not pull the sign-in store in with it.
 */

// Intent.FLAG_GRANT_READ_URI_PERMISSION: the viewer reads the content URI expo-file-system exports.
const FLAG_GRANT_READ_URI_PERMISSION = 1

function realDeps(): CcrAttachmentDeps {
  return {
    accounts: async () => (await fetchAccountCredentials()).map((account) => ({ id: account.id, accessToken: account.accessToken })),
    download: async (url, destination, headers) => {
      await FileSystem.makeDirectoryAsync(destination.slice(0, destination.lastIndexOf('/')), { intermediates: true }).catch(() => undefined)
      const result = await FileSystem.downloadAsync(url, destination, { headers })
      return { status: result.status, uri: result.uri }
    },
    remove: (uri) => FileSystem.deleteAsync(uri, { idempotent: true }),
    cacheDir: FileSystem.cacheDirectory ?? ''
  }
}

/** One download per file at a time and per run: a failed one is asked again on the next tap. */
const inFlight = new Map<string, Promise<CcrAttachmentOutcome>>()
const done = new Map<string, string>()

/** The attachment's cache file, downloading it first when this run has not. */
export function loadCcrAttachmentFile(ref: CcrAttachmentRef): Promise<CcrAttachmentOutcome> {
  const have = done.get(ref.fileUuid)
  if (have) {
    return Promise.resolve({ uri: have })
  }
  let running = inFlight.get(ref.fileUuid)
  if (!running) {
    running = fetchCcrAttachment(ref, realDeps())
      .then((outcome) => {
        if ('uri' in outcome) {
          done.set(ref.fileUuid, outcome.uri)
        }
        return outcome
      })
      .finally(() => inFlight.delete(ref.fileUuid))
    inFlight.set(ref.fileUuid, running)
  }
  return running
}

/** A card's tap: the file in the viewer, or one line saying why it could not be. */
export async function openCcrAttachment(ref: CcrAttachmentRef): Promise<void> {
  const outcome = await loadCcrAttachmentFile(ref)
  if ('error' in outcome) {
    console.warn(`[ccr-attachment] ${ref.fileUuid}: ${outcome.error}`)
    Alert.alert(`Can't open ${ref.fileName}`, outcome.error)
    return
  }
  try {
    const data = await FileSystem.getContentUriAsync(outcome.uri)
    await withPickerGate(() => IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data, type: ccrAttachmentMime(ref.fileName), flags: FLAG_GRANT_READ_URI_PERMISSION }))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`[ccr-attachment] ${ref.fileUuid}: no viewer took it: ${reason}`)
    Alert.alert(`Can't open ${ref.fileName}`, 'No app on this phone opens this kind of file.')
  }
}
