import { describe, expect, it } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'
import {
  mixHexColor,
  SHIMMER_BAND_DEPTH,
  SHIMMER_HALF_BAND,
  SHIMMER_PERIOD_MS,
  shimmerBandColor,
  shimmerBandWeight
} from './mobile-native-chat-shimmer'

// Measured 2026-09-26 from the user's screen recording of the Claude app
// (1080x2316, resampled to 50 fps): the "Running agent" label's darker band
// sweeps left to right once every 1.50 s at a constant speed, a triangle about
// six characters wide at its foot and 3.4 at half depth, and takes a character
// at its centre down to 26% of its contrast against the page.

const LABEL = 'Running agent'
const COUNT = LABEL.length

function weights(phase: number, count = COUNT): number[] {
  return Array.from({ length: count }, (_, index) => shimmerBandWeight(phase, index, count))
}

/** The phase at which the band's centre sits on character `index`. */
function centredOn(index: number, count = COUNT): number {
  return (index + 0.5 + SHIMMER_HALF_BAND) / (count + 2 * SHIMMER_HALF_BAND)
}

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16)
  return 0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255)
}

describe('the running label shimmer, as the Claude app sweeps it', () => {
  it('sweeps once every 1.5 s, the period measured off the recording', () => {
    expect(SHIMMER_PERIOD_MS).toBe(1500)
    for (const phase of [0.1, 0.37, 0.8]) {
      const next = weights(phase + 1)
      weights(phase).forEach((weight, index) => expect(next[index]).toBeCloseTo(weight, 9))
    }
  })

  it('dims no character where the loop starts over, so the seam never shows', () => {
    expect(weights(0).every((weight) => weight === 0)).toBe(true)
    expect(weights(0.999).every((weight) => weight === 0)).toBe(true)
  })

  it('walks its darkest point from the first character to the last, one after another', () => {
    for (let index = 0; index < COUNT; index++) {
      const drawn = weights(centredOn(index))
      expect(drawn[index]).toBeCloseTo(1, 9)
      expect(drawn.indexOf(Math.max(...drawn))).toBe(index)
    }
  })

  // The recording's band reached "R" 0.25 s after it began to dim it, and went
  // from "R" to "t" in 0.91 s at a constant 230 px/s.
  it('crosses "Running agent" at the recorded pace, the same distance every step', () => {
    const msToPeak = (index: number) => centredOn(index) * SHIMMER_PERIOD_MS
    const steps = Array.from({ length: COUNT - 1 }, (_, index) => msToPeak(index + 1) - msToPeak(index))
    expect(Math.max(...steps) - Math.min(...steps)).toBeLessThan(1e-9)
    expect(msToPeak(COUNT - 1) - msToPeak(0)).toBeGreaterThan(850)
    expect(msToPeak(COUNT - 1) - msToPeak(0)).toBeLessThan(1000)
    // The first character starts to dim a quarter of a second before the
    // band's centre reaches it.
    const firstDims = (0.5 / (COUNT + 2 * SHIMMER_HALF_BAND)) * SHIMMER_PERIOD_MS
    expect(msToPeak(0) - firstDims).toBeGreaterThan(200)
    expect(msToPeak(0) - firstDims).toBeLessThan(300)
    expect(shimmerBandWeight(0.4 / (COUNT + 2 * SHIMMER_HALF_BAND), 0, COUNT)).toBe(0)
    expect(shimmerBandWeight(0.6 / (COUNT + 2 * SHIMMER_HALF_BAND), 0, COUNT)).toBeGreaterThan(0)
  })

  it('is about six characters wide at its foot and three at half depth, with soft edges', () => {
    const drawn = weights(centredOn(6))
    expect(drawn.filter((weight) => weight > 0)).toHaveLength(5)
    expect(drawn.filter((weight) => weight >= 0.5)).toHaveLength(3)
    // A ramp either side, not a hard-edged block.
    expect(drawn[5]).toBeCloseTo(2 / 3)
    expect(drawn[4]).toBeCloseTo(1 / 3)
    expect(drawn[3]).toBe(0)
    expect(drawn[7]).toBeCloseTo(drawn[5]!)
    expect(drawn[8]).toBeCloseTo(drawn[4]!)
  })

  it('still sweeps a one-character label, and draws nothing for an empty one or a stray index', () => {
    expect(shimmerBandWeight(0.5, 0, 1)).toBeCloseTo(1, 9)
    expect(shimmerBandWeight(0, 0, 1)).toBe(0)
    expect(shimmerBandWeight(0.5, 0, 0)).toBe(0)
    expect(shimmerBandWeight(0.5, -1, COUNT)).toBe(0)
    expect(shimmerBandWeight(0.5, COUNT, COUNT)).toBe(0)
  })

  it('takes a character at the band centre three quarters of the way to the page', () => {
    expect(SHIMMER_BAND_DEPTH).toBe(0.74)
    expect(shimmerBandColor('#B8B4AB', '#1A1917')).toBe(mixHexColor('#B8B4AB', '#1A1917', 0.74))
    expect(mixHexColor('#B8B4AB', '#1A1917', 0.74)).toBe('#43413d')
    expect(mixHexColor('#000000', '#FFFFFF', 0)).toBe('#000000')
    expect(mixHexColor('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(mixHexColor('#000', '#fff', 0.5)).toBe('#808080')
  })

  it('draws a darker band in dark mode and a lighter one in light mode: the label sinks into the page', () => {
    const dark = shimmerBandColor(darkColors.textSecondary, darkColors.bg)
    const light = shimmerBandColor(lightColors.textSecondary, lightColors.bg)
    expect(luminance(dark)).toBeLessThan(luminance(darkColors.textSecondary))
    expect(luminance(dark)).toBeGreaterThan(luminance(darkColors.bg))
    expect(luminance(light)).toBeGreaterThan(luminance(lightColors.textSecondary))
    expect(luminance(light)).toBeLessThan(luminance(lightColors.bg))
  })

  // A colour this cannot read is never guessed at: the band draws in the
  // label's own colour, which is an invisible sweep over a readable label.
  it('leaves the label its own colour when either colour is not a plain hex', () => {
    expect(mixHexColor('rgba(0, 0, 0, 0.5)', '#FFFFFF', 0.5)).toBeNull()
    expect(mixHexColor('#FFFFFF', 'transparent', 0.5)).toBeNull()
    expect(mixHexColor('#12345', '#FFFFFF', 0.5)).toBeNull()
    expect(shimmerBandColor('rgba(0, 0, 0, 0.5)', '#1A1917')).toBe('rgba(0, 0, 0, 0.5)')
  })
})
