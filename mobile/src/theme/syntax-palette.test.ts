import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../test/contrast'
import {
  darkSyntaxPalette,
  lightSyntaxPalette,
  syntaxPaletteForScheme,
  SYNTAX_TOKEN_ROLES,
  type SyntaxPalette
} from './syntax-palette'
import { darkColors, lightColors } from './tokens'

const WCAG_AA_BODY = 4.5

const SCHEMES = [
  ['light', lightSyntaxPalette, lightColors.codeBg],
  ['dark', darkSyntaxPalette, darkColors.codeBg]
] as const

describe('the code colours in both schemes', () => {
  it.each(SCHEMES)('%s: every token colour reads on the code surface', (scheme, palette) => {
    for (const role of SYNTAX_TOKEN_ROLES) {
      expect(
        contrastRatio(palette[role], palette.surface),
        `${scheme} ${role} ${palette[role]} on ${palette.surface}`
      ).toBeGreaterThanOrEqual(WCAG_AA_BODY)
    }
  })

  it.each(SCHEMES)('%s: every token colour also reads inside a chat code block', (scheme, palette, codeBg) => {
    for (const role of SYNTAX_TOKEN_ROLES) {
      expect(
        contrastRatio(palette[role], codeBg),
        `${scheme} ${role} ${palette[role]} on ${codeBg}`
      ).toBeGreaterThanOrEqual(WCAG_AA_BODY)
    }
  })

  it.each(SCHEMES)('%s: line numbers read, and indent guides stay a faint line', (scheme, palette) => {
    expect(contrastRatio(palette.gutter, palette.surface), scheme).toBeGreaterThanOrEqual(WCAG_AA_BODY)
    const guide = contrastRatio(palette.indentGuide, palette.surface)
    expect(guide, `${scheme} guide`).toBeGreaterThan(1.2)
    expect(guide, `${scheme} guide`).toBeLessThan(3)
  })

  it('gives the light scheme its own colour for every role, so light mode never borrows the dark set', () => {
    const roles = Object.keys(darkSyntaxPalette) as (keyof SyntaxPalette)[]
    for (const role of roles) {
      expect(lightSyntaxPalette[role], role).not.toBe(darkSyntaxPalette[role])
    }
  })

  it('tells flow keywords from declaration keywords, and functions from types, as the desktop does', () => {
    for (const palette of [lightSyntaxPalette, darkSyntaxPalette]) {
      expect(palette.control).not.toBe(palette.keyword)
      expect(palette.function).not.toBe(palette.type)
      expect(palette.string).not.toBe(palette.number)
      expect(new Set([palette.bracket1, palette.bracket2, palette.bracket3]).size).toBe(3)
    }
  })

  it('hands each scheme its palette', () => {
    expect(syntaxPaletteForScheme('light')).toBe(lightSyntaxPalette)
    expect(syntaxPaletteForScheme('dark')).toBe(darkSyntaxPalette)
  })
})
