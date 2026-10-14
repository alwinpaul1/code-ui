import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => {
  function flatten(style: unknown): Record<string, unknown> | undefined {
    if (style == null) {
      return undefined
    }
    if (Array.isArray(style)) {
      return Object.assign({}, ...style.map((item) => flatten(item) ?? {}))
    }
    if (typeof style === 'object') {
      return { ...(style as Record<string, unknown>) }
    }
    return undefined
  }
  return { StyleSheet: { flatten } }
})

import { StyleSheet, type StyleProp, type TextStyle } from 'react-native'
import { fontFamily } from './tokens'
import { instrumentSansTextStyle } from './instrument-sans-text'

/** The face a styled Text draws in. The helper is generic over its input, so
 *  the flattened union has no common `fontFamily` for inference to see. */
function faceOf(style: unknown): string | undefined {
  return StyleSheet.flatten(style as StyleProp<TextStyle>)?.fontFamily
}

describe('legacy text that names no face', () => {
  it('draws Instrument Sans regular when a screen sets no family and no weight', () => {
    const styled = instrumentSansTextStyle(undefined)
    expect(faceOf(styled)).toBe(fontFamily.regular)
  })

  it('picks the Instrument Sans face that matches a numeric weight', () => {
    expect(faceOf(instrumentSansTextStyle({ fontWeight: '500' }))).toBe(fontFamily.medium)
    expect(faceOf(instrumentSansTextStyle({ fontWeight: '600', fontSize: 15 }))).toBe(fontFamily.semibold)
    expect(faceOf(instrumentSansTextStyle({ fontWeight: '700' }))).toBe(fontFamily.bold)
    expect(faceOf(instrumentSansTextStyle({ fontWeight: 'bold' }))).toBe(fontFamily.bold)
  })

  it('leaves a code face alone', () => {
    const style = { fontFamily: fontFamily.mono, fontWeight: '600' as const }
    expect(instrumentSansTextStyle(style)).toBe(style)
  })

  it('leaves an explicit Instrument Sans weight alone', () => {
    const style = [{ fontFamily: fontFamily.semibold }, { color: '#111' }]
    expect(instrumentSansTextStyle(style)).toBe(style)
  })

  it('reads the weight from the last style in a list', () => {
    const styled = instrumentSansTextStyle([{ color: '#111' }, { fontWeight: '600' }])
    expect(faceOf(styled)).toBe(fontFamily.semibold)
  })

  it('keeps the React Native Text and TextInput hooks in the patch', () => {
    const patch = readFileSync(new URL('../../patches/react-native@0.86.3.patch', import.meta.url), 'utf8')
    expect(patch).toContain('diff --git a/Libraries/Text/Text.js')
    expect(patch).toContain('diff --git a/Libraries/Components/TextInput/TextInput.js')
    expect(patch).toContain('global.__codeUiTextStyle(_style)')
    const fonts = readFileSync(new URL('./fonts.ts', import.meta.url), 'utf8')
    expect(fonts).toContain('installInstrumentSansText()')
  })
})

// 2026-10-14: the live dictation caption and Markdown italics drew UPRIGHT on
// the phone. fonts.ts loaded the four upright Instrument Sans files only, and
// Android picks a face by the family's NAME (a custom family has no italic
// sibling to switch to), so `fontStyle: 'italic'` had nothing to slant. The
// package ships the four italic files; their family names are
// `InstrumentSans_<weight><Name>_Italic`.
describe('italic text', () => {
  const ITALIC = {
    regular: 'InstrumentSans_400Regular_Italic',
    medium: 'InstrumentSans_500Medium_Italic',
    semibold: 'InstrumentSans_600SemiBold_Italic',
    bold: 'InstrumentSans_700Bold_Italic'
  } as const

  it('draws a Markdown italic in the italic face, not the upright one', () => {
    expect(faceOf(instrumentSansTextStyle({ fontStyle: 'italic' }))).toBe(ITALIC.regular)
    expect(faceOf(instrumentSansTextStyle({ fontStyle: 'italic', fontSize: 15, lineHeight: 22 }))).toBe(ITALIC.regular)
  })

  it.each([
    ['500', ITALIC.medium],
    ['600', ITALIC.semibold],
    ['700', ITALIC.bold],
    ['bold', ITALIC.bold],
    ['400', ITALIC.regular],
    ['normal', ITALIC.regular]
  ] as const)('maps weight %s and italic to %s', (fontWeight, face) => {
    expect(faceOf(instrumentSansTextStyle({ fontStyle: 'italic', fontWeight }))).toBe(face)
  })

  it('slants the face a screen named itself, as the dictation caption does', () => {
    // MobileNativeChatComposer names fonts.regular, and the caption adds the italic.
    expect(faceOf(instrumentSansTextStyle({ fontFamily: fontFamily.regular, fontStyle: 'italic', fontSize: 17 }))).toBe(
      ITALIC.regular
    )
    expect(faceOf(instrumentSansTextStyle({ fontFamily: fontFamily.medium, fontStyle: 'italic' }))).toBe(ITALIC.medium)
    expect(faceOf(instrumentSansTextStyle([{ fontFamily: fontFamily.semibold }, { fontStyle: 'italic' }]))).toBe(
      ITALIC.semibold
    )
    expect(faceOf(instrumentSansTextStyle({ fontFamily: fontFamily.bold, fontStyle: 'italic' }))).toBe(ITALIC.bold)
  })

  it('keeps every other property of the style it slants', () => {
    const styled = instrumentSansTextStyle({ fontFamily: fontFamily.regular, fontStyle: 'italic', fontSize: 17, color: '#111' })
    expect(StyleSheet.flatten(styled as StyleProp<TextStyle>)).toMatchObject({ fontStyle: 'italic', fontSize: 17, color: '#111' })
  })

  it('leaves upright text upright', () => {
    expect(faceOf(instrumentSansTextStyle({ fontStyle: 'normal' }))).toBe(fontFamily.regular)
    expect(faceOf(instrumentSansTextStyle({ fontFamily: fontFamily.semibold, fontStyle: 'normal' }))).toBe(fontFamily.semibold)
    expect(faceOf(instrumentSansTextStyle({ fontWeight: '600' }))).toBe(fontFamily.semibold)
  })

  it('leaves the code face alone: no italic JetBrains Mono is bundled', () => {
    const style = { fontFamily: fontFamily.mono, fontStyle: 'italic' as const }
    expect(instrumentSansTextStyle(style)).toBe(style)
  })

  it('leaves an italic face a screen already named', () => {
    const style = { fontFamily: ITALIC.medium, fontStyle: 'italic' as const }
    expect(instrumentSansTextStyle(style)).toBe(style)
  })

  it('names italic faces the font package exports, and loads all four at start', () => {
    const exported = readFileSync(
      new URL('../../node_modules/@expo-google-fonts/instrument-sans/index.d.ts', import.meta.url),
      'utf8'
    )
    for (const face of Object.values(ITALIC)) {
      expect(exported).toContain(`export const ${face}: number`)
    }
    const fonts = readFileSync(new URL('./fonts.ts', import.meta.url), 'utf8')
    const loaded = fonts.slice(fonts.indexOf('useFonts({'))
    for (const face of Object.values(ITALIC)) {
      expect(loaded).toContain(`${face},`)
    }
  })
})
