import { StyleSheet, type StyleProp, type TextStyle } from 'react-native'
import { fontFamily } from './tokens'

/**
 * Gives UI text that never named a face an Instrument Sans weight. An explicit
 * family, including the code face, is left untouched. Android does not
 * synthesize a weight once a custom family is set, so a `fontWeight` of 600
 * has to become the semibold file, not a regular file plus a weight.
 */
export function instrumentSansTextStyle<T>(style: T): [{ fontFamily: string }, T] | T {
  const flat = StyleSheet.flatten(style as StyleProp<TextStyle>)
  if (typeof flat?.fontFamily === 'string' && flat.fontFamily.length > 0) {
    return style
  }
  return [{ fontFamily: faceForWeight(flat?.fontWeight) }, style]
}

function faceForWeight(weight: TextStyle['fontWeight'] | undefined): string {
  const key = weight == null ? '' : String(weight)
  if (key === '500') {
    return fontFamily.medium
  }
  if (key === '600') {
    return fontFamily.semibold
  }
  if (key === '700' || key === '800' || key === '900' || key === 'bold') {
    return fontFamily.bold
  }
  return fontFamily.regular
}

/** Installed once, from the root font module, so every Text and TextInput
 *  that the native renderer draws picks up the face. */
export function installInstrumentSansText(): void {
  globalThis.__codeUiTextStyle = instrumentSansTextStyle
}
