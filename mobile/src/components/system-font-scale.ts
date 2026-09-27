import { PixelRatio, Platform } from 'react-native'
import { androidSpScale, type SpScale } from './android-font-scale'

/** The system font size (Settings > Display > Font size); 1 where the
 *  platform does not say. */
export function systemFontScale(): number {
  try {
    return PixelRatio.getFontScale()
  } catch {
    return 1
  }
}

/** The Android API level, which decides whether sp scale on a curve
 *  (android-font-scale.ts); 0 where the platform does not say (linear). */
export function androidApiLevel(): number {
  try {
    return Platform.OS === 'android' ? Number(Platform.Version) || 0 : 0
  } catch {
    return 0
  }
}

/** How this phone turns sp into dp at its system font size. */
export function systemSpScale(): SpScale {
  return androidSpScale(systemFontScale(), androidApiLevel())
}
