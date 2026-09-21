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

import { StyleSheet } from 'react-native'
import { fontFamily } from './tokens'
import { instrumentSansTextStyle } from './instrument-sans-text'

describe('legacy text that names no face', () => {
  it('draws Instrument Sans regular when a screen sets no family and no weight', () => {
    const styled = instrumentSansTextStyle(undefined)
    expect(StyleSheet.flatten(styled).fontFamily).toBe(fontFamily.regular)
  })

  it('picks the Instrument Sans face that matches a numeric weight', () => {
    expect(StyleSheet.flatten(instrumentSansTextStyle({ fontWeight: '500' })).fontFamily).toBe(
      fontFamily.medium
    )
    expect(StyleSheet.flatten(instrumentSansTextStyle({ fontWeight: '600', fontSize: 15 })).fontFamily).toBe(
      fontFamily.semibold
    )
    expect(StyleSheet.flatten(instrumentSansTextStyle({ fontWeight: '700' })).fontFamily).toBe(
      fontFamily.bold
    )
    expect(StyleSheet.flatten(instrumentSansTextStyle({ fontWeight: 'bold' })).fontFamily).toBe(
      fontFamily.bold
    )
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
    expect(StyleSheet.flatten(styled).fontFamily).toBe(fontFamily.semibold)
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
