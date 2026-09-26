import { Platform, Share } from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import {
  downloadMobilePdf,
  suggestedPdfFileName,
  type MobilePdfDownloadDeps,
  type MobilePdfDownloadOutcome
} from './mobile-pdf-download'
import {
  createAndroidDocument,
  deleteAndroidDocument,
  writeAndroidDocumentBase64
} from './android-create-document'

const deviceDeps: MobilePdfDownloadDeps = {
  createDocument: async (suggestedName) =>
    Platform.OS === 'android' ? createAndroidDocument(suggestedName, 'application/pdf') : null,
  // The cached copy is a file:// URI in the app's own cache, which the legacy module reads.
  readBase64: (uri) => FileSystem.readAsStringAsync(uri, { encoding: 'base64' }),
  writeBase64: writeAndroidDocumentBase64,
  remove: deleteAndroidDocument
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
