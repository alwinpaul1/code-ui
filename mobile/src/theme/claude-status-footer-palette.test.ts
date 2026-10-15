import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../test/contrast'
import { claudeStatusFooterPalette } from './claude-status-footer-palette'
import { darkColors, lightColors } from './tokens'

// The hex values are ad5.C0() and pl7.e / pl7.Q of com.anthropic.claude 1.261009.20.
describe('the Claude working footer palette', () => {
  it('is the decompiled clay, link and body in light', () => {
    expect(claudeStatusFooterPalette('light')).toEqual({ clay: '#C6613F', link: '#184F95', body: '#7B7974' })
  })

  it('is the decompiled clay, link and body in dark', () => {
    expect(claudeStatusFooterPalette('dark')).toEqual({ clay: '#D97757', link: '#6DA7EC', body: '#97958D' })
  })

  it('keeps the link readable on the page of its own scheme', () => {
    expect(contrastRatio(claudeStatusFooterPalette('light').link, lightColors.bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(claudeStatusFooterPalette('dark').link, darkColors.bg)).toBeGreaterThanOrEqual(4.5)
  })
})
