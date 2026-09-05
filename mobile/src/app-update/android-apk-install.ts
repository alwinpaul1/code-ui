import * as FileSystem from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'

// Downloads a release APK into the app cache and hands it to Android's package
// installer. Code UI is sideloaded (no Play Store), so this is the whole
// "install update" path: the system installer takes over from the intent and
// asks the user to confirm; REQUEST_INSTALL_PACKAGES in app.json lets the
// installer accept the request from this app.

const UPDATE_DIR = `${FileSystem.cacheDirectory ?? ''}updates/`
const APK_MIME = 'application/vnd.android.package-archive'
// Intent.FLAG_GRANT_READ_URI_PERMISSION — the installer reads the content URI
// exported by expo-file-system's FileProvider.
const FLAG_GRANT_READ_URI_PERMISSION = 1

export function apkFileUriForVersion(version: string): string {
  return `${UPDATE_DIR}code-ui-${version.replace(/[^0-9A-Za-z.-]/g, '_')}.apk`
}

/**
 * Download `url` to the cache, reporting 0..1 progress. Resolves the local
 * file URI. Any partial file from an earlier attempt is replaced.
 */
export async function downloadApk(input: {
  url: string
  version: string
  onProgress?: (fraction: number) => void
}): Promise<string> {
  const fileUri = apkFileUriForVersion(input.version)
  await FileSystem.makeDirectoryAsync(UPDATE_DIR, { intermediates: true }).catch(() => {})
  await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {})
  const download = FileSystem.createDownloadResumable(input.url, fileUri, {}, (progress) => {
    const total = progress.totalBytesExpectedToWrite
    if (total > 0) {
      input.onProgress?.(Math.min(1, progress.totalBytesWritten / total))
    }
  })
  const result = await download.downloadAsync()
  if (!result || result.status < 200 || result.status >= 300) {
    throw new Error(`Download failed (HTTP ${result?.status ?? 'unknown'})`)
  }
  return result.uri
}

/** Open the system package installer on a downloaded APK. */
export async function openApkInstaller(fileUri: string): Promise<void> {
  const contentUri = await FileSystem.getContentUriAsync(fileUri)
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    type: APK_MIME,
    flags: FLAG_GRANT_READ_URI_PERMISSION
  })
}
