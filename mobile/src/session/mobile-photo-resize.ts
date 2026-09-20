import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { PHOTO_QUALITY, type MobileImageResizer } from './mobile-image-source-picker'

/** Scales a photo file down with the image manipulator and writes a JPEG.
 *  Kept apart from the picker so the picker's tests never load the
 *  manipulator's React Native entry. */
export const resizeMobilePhoto: MobileImageResizer = async (uri, target) => {
  const context = ImageManipulator.manipulate(uri)
  try {
    context.resize(target)
    const rendered = await context.renderAsync()
    try {
      const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_QUALITY })
      return { uri: saved.uri, width: saved.width, height: saved.height }
    } finally {
      rendered.release()
    }
  } finally {
    context.release()
  }
}
