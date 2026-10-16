import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../test/contrast'
import { claudeStatusFooterPalette } from './claude-status-footer-palette'
import { darkColors, lightColors } from './tokens'

// The hex values are ad5.C0() and pl7.e / pl7.Q of com.anthropic.claude 1.261009.20, and the live
// tool row's ad5.x0() / ad5.y() of 1.261013.20 (g95 light, e65 dark).
describe('the Claude working footer palette', () => {
  it('is the decompiled clay, link and body in light', () => {
    expect(claudeStatusFooterPalette('light')).toEqual({
      clay: '#C6613F',
      link: '#184F95',
      body: '#7B7974',
      toolLabel: '#52514E',
      toolClock: '#898781'
    })
  })

  it('is the decompiled clay, link and body in dark', () => {
    expect(claudeStatusFooterPalette('dark')).toEqual({
      clay: '#D97757',
      link: '#6DA7EC',
      body: '#97958D',
      toolLabel: '#C3C2B7',
      toolClock: '#898781'
    })
  })

  it('keeps the live tool row\'s label readable on the page of its own scheme', () => {
    expect(contrastRatio(claudeStatusFooterPalette('light').toolLabel, lightColors.bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(claudeStatusFooterPalette('dark').toolLabel, darkColors.bg)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the link readable on the page of its own scheme', () => {
    expect(contrastRatio(claudeStatusFooterPalette('light').link, lightColors.bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(claudeStatusFooterPalette('dark').link, darkColors.bg)).toBeGreaterThanOrEqual(4.5)
  })
})
