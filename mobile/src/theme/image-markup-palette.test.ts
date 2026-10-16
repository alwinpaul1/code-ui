import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../test/contrast'
import { imageMarkupPalette } from './image-markup-palette'

// ym7.q / .O / .x / .e and g79.b / .d of com.anthropic.claude 1.261013.20 (k79.java, zxy light,
// yxy dark), as the markup screen uses them (zqh.java, vqh.java).
describe('the image markup palette', () => {
  it('is the decompiled pill, ink, hairline and clay in light', () => {
    expect(imageMarkupPalette('light')).toEqual({
      canvas: '#000000',
      pill: '#F9F9F7',
      glyph: '#131313',
      glyphDisabled: 'rgba(19, 19, 19, 0.38)',
      divider: 'rgba(30, 30, 29, 0.15)',
      done: '#C6613F',
      canvasText: '#FFFFFF'
    })
  })

  it('is the decompiled pill, ink, hairline and clay in dark', () => {
    expect(imageMarkupPalette('dark')).toEqual({
      canvas: '#000000',
      pill: '#151515',
      glyph: '#F9F9F7',
      glyphDisabled: 'rgba(249, 249, 247, 0.38)',
      divider: 'rgba(225, 224, 217, 0.15)',
      done: '#D97757',
      canvasText: '#FFFFFF'
    })
  })

  it.each(['light', 'dark'] as const)('keeps the bar glyphs readable on their pill in %s', (scheme) => {
    const palette = imageMarkupPalette(scheme)
    expect(contrastRatio(palette.glyph, palette.pill)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(palette.done, palette.pill)).toBeGreaterThanOrEqual(3)
  })
})
