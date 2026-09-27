import { Platform } from 'react-native'
import { triggerError, triggerSuccess } from '../platform/haptics'
import {
  createAndroidDocument,
  deleteAndroidDocument,
  writeAndroidDocumentBase64
} from './android-create-document'
import { createSaveToPhoneRunner, type MobileFileSaveTarget } from './mobile-file-save'

const androidSaveTarget: MobileFileSaveTarget = {
  createDocument: createAndroidDocument,
  writeBase64: writeAndroidDocumentBase64,
  remove: deleteAndroidDocument
}

/**
 * Android only. iOS has no create-document picker; it would need a cache copy handed to the share
 * sheet, which is not built. The web shell has no file system. Neither gets the action, rather
 * than one that fails.
 */
export const isSaveToPhoneSupported = Platform.OS === 'android'

export const saveDesktopFileToPhoneOnDevice = createSaveToPhoneRunner(androidSaveTarget, {
  onSaved: triggerSuccess,
  onProblem: triggerError
})
