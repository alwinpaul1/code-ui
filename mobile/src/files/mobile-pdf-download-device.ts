import { Platform, Share } from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'
import {
  downloadMobilePdf,
  suggestedPdfFileName,
  type MobilePdfDownloadDeps,
  type MobilePdfDownloadOutcome
} from './mobile-pdf-download'

const ANDROID_CREATE_DOCUMENT = 'android.intent.action.CREATE_DOCUMENT'
const ANDROID_CATEGORY_OPENABLE = 'android.intent.category.OPENABLE'
const ANDROID_EXTRA_TITLE = 'android.intent.extra.TITLE'

const deviceDeps: MobilePdfDownloadDeps = {

  createDocument: async (suggestedName) => {
    if (Platform.OS === 'android') {
      const result = await IntentLauncher.startActivityAsync(ANDROID_CREATE_DOCUMENT, {
        type: 'application/pdf',
        category: ANDROID_CATEGORY_OPENABLE,
        extra: { [ANDROID_EXTRA_TITLE]: suggestedName }
      })
      return result.resultCode === IntentLauncher.ResultCode.Success && result.data
        ? result.data
        : null
    }
    return null
  },
  readBase64: (uri) => FileSystem.readAsStringAsync(uri, { encoding: 'base64' }),
  writeBase64: (targetUri, base64) =>
    FileSystem.writeAsStringAsync(targetUri, base64, { encoding: 'base64' })
}

/** iOS has no "save as" intent; the share sheet is how a file leaves an app. */
export async function shareMobilePdf(uri: string, fileName: string): Promise<void> {
  await Share.share({ url: uri, title: suggestedPdfFileName(fileName) })
}

export const isMobilePdfDownloadSupported = Platform.OS === 'android'

/** Android: the system "save as" picker. Elsewhere: the share sheet. */
export async function savePreviewedPdf(input: {
  uri: string
  fileName: string
}): Promise<MobilePdfDownloadOutcome> {
  if (isMobilePdfDownloadSupported) {
    return downloadMobilePdf(input, deviceDeps)
  }
  try {
    await shareMobilePdf(input.uri, input.fileName)
    return 'saved'
  } catch {
    return 'failed'
  }
}
