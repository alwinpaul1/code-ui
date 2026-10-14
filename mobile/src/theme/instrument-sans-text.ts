import { StyleSheet, type StyleProp, type TextStyle } from 'react-native'
import { fontFamily, fontFamilyItalic } from './tokens'

/** An upright Instrument Sans name and the italic file that slants it. */
const ITALIC_OF: Record<string, string> = {
  [fontFamily.regular]: fontFamilyItalic.regular,
  [fontFamily.medium]: fontFamilyItalic.medium,
  [fontFamily.semibold]: fontFamilyItalic.semibold,
  [fontFamily.bold]: fontFamilyItalic.bold
}

/**
 * Gives UI text that never named a face an Instrument Sans weight, in its
 * italic file when the style asks for italic. A face named explicitly is left
 * as named, except an upright Instrument Sans name that asks for italic: it
 * becomes the italic file of that weight (the dictation caption names
 * `fonts.regular` itself). The code face is never touched. Android does not
 * synthesize a weight or a slant once a custom family is set, so a
 * `fontWeight` of 600 has to become the semibold file, and `fontStyle:
 * 'italic'` an italic file, not a regular file plus a style.
 */
export function instrumentSansTextStyle<T>(
  style: T
): [{ fontFamily: string }, T] | [T, { fontFamily: string }] | T {
  const flat = StyleSheet.flatten(style as StyleProp<TextStyle>)
  const italic = flat?.fontStyle === 'italic'
  if (typeof flat?.fontFamily === 'string' && flat.fontFamily.length > 0) {
    const slanted = italic ? ITALIC_OF[flat.fontFamily] : undefined
    // After the style, so it wins over the family the style named.
    return slanted ? [style, { fontFamily: slanted }] : style
  }
  return [{ fontFamily: faceForWeight(flat?.fontWeight, italic) }, style]
}

function faceForWeight(weight: TextStyle['fontWeight'] | undefined, italic: boolean): string {
  const faces = italic ? fontFamilyItalic : fontFamily
  const key = weight == null ? '' : String(weight)
  if (key === '500') {
    return faces.medium
  }
  if (key === '600') {
    return faces.semibold
  }
  if (key === '700' || key === '800' || key === '900' || key === 'bold') {
    return faces.bold
  }
  return faces.regular
}

/** Installed once, from the root font module, so every Text and TextInput
 *  that the native renderer draws picks up the face. */
export function installInstrumentSansText(): void {
  globalThis.__codeUiTextStyle = instrumentSansTextStyle
}
