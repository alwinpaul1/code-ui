import { Platform, Share } from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import { downloadMobileImage, type MobileImageDownloadDeps, type MobileImageDownloadOutcome } from './mobile-image-download'
import { createAndroidDocument, deleteAndroidDocument, writeAndroidDocumentBase64 } from './android-create-document'

const deviceDeps: MobileImageDownloadDeps = {
  createDocument: (suggestedName, mimeType) => createAndroidDocument(suggestedName, mimeType),
  readBase64: (uri) => FileSystem.readAsStringAsync(uri, { encoding: 'base64' }),
  writeBase64: writeAndroidDocumentBase64,
  remove: deleteAndroidDocument
}

/** Android: the system "Save to" picker. Elsewhere: the share sheet, the
 *  way a file leaves an iOS app (mobile-pdf-download-device.ts). */
export async function saveViewedImage(uri: string): Promise<MobileImageDownloadOutcome> {
  if (Platform.OS === 'android') {
    return downloadMobileImage({ uri }, deviceDeps)
  }
  try {
    await Share.share({ url: uri })
    return { status: 'saved' }
  } catch {
    return { status: 'failed' }
  }
}
