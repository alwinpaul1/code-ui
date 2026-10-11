import { describe, expect, it } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'
import {
  mixHexColor,
  SHIMMER_BAND_ALPHA,
  SHIMMER_BAND_HALF_WIDTH,
  SHIMMER_FRAMES_PER_SECOND,
  SHIMMER_PERIOD_MS,
  SHIMMER_SWEEP_FROM,
  SHIMMER_SWEEP_TO,
  shimmerBandCentre,
  shimmerBandColor,
  shimmerBandWeight,
  shimmerFramePhase
} from './mobile-native-chat-shimmer'

// The Claude app's own shimmer, read from its code (1.261009.20, decompiled
// 2026-10-11; docs/claude-app-implementation-notes.md in the main checkout,
// "Shimmer (hu20.e -> jqv.a)"): the label's brush is a horizontal linear
// gradient of base, base at 10% alpha, base, centred on p * W with a
// half-width of 0.25 * W (W the text's width), and p runs from -0.25 to 1.25
// on a 1500 ms linear tween that restarts. It replaced the values measured off
// a recording on 2026-09-26 (a six-character band down to 26% contrast).

const LABEL = 'Running agent'
const COUNT = LABEL.length

function weights(phase: number, count = COUNT): number[] {
  return Array.from({ length: count }, (_, index) => shimmerBandWeight(phase, index, count))
}

/** Where character `index` of `count` sits across the text, 0 to 1. */
const at = (index: number, count = COUNT) => (index + 0.5) / count

/** The phase at which the band's centre sits on character `index`. */
const centredOn = (index: number, count = COUNT) =>
  (at(index, count) - SHIMMER_SWEEP_FROM) / (SHIMMER_SWEEP_TO - SHIMMER_SWEEP_FROM)

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16)
  return 0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255)
}

describe("the running label shimmer, with the Claude app's own values", () => {
  it('sweeps once every 1500 ms and restarts, the same at every whole number of sweeps', () => {
    expect(SHIMMER_PERIOD_MS).toBe(1500)
    for (const phase of [0.1, 0.37, 0.8]) {
      const next = weights(phase + 1)
      weights(phase).forEach((weight, index) => expect(next[index]).toBeCloseTo(weight, 9))
    }
  })

  it('moves the band centre from -0.25 to 1.25 of the width, in a straight line', () => {
    expect(SHIMMER_SWEEP_FROM).toBe(-0.25)
    expect(SHIMMER_SWEEP_TO).toBe(1.25)
    expect(shimmerBandCentre(0)).toBeCloseTo(-0.25, 9)
    expect(shimmerBandCentre(0.5)).toBeCloseTo(0.5, 9)
    expect(shimmerBandCentre(0.999999)).toBeCloseTo(1.25, 4)
    // Linear: equal steps of phase move the centre equal distances.
    const steps = [0.1, 0.2, 0.3, 0.4].map((phase) => shimmerBandCentre(phase + 0.1) - shimmerBandCentre(phase))
    for (const step of steps) {
      expect(step).toBeCloseTo(0.15, 9)
    }
  })

  it('is half the text wide: 0.25 of the width either side of its centre, fading in a straight line', () => {
    expect(SHIMMER_BAND_HALF_WIDTH).toBe(0.25)
    const count = 100
    const drawn = weights(centredOn(49, count), count)
    expect(drawn[49]).toBeCloseTo(1, 9)
    // Dimmed across half the text, nothing beyond.
    expect(drawn.filter((weight) => weight > 0).length).toBeGreaterThanOrEqual(49)
    expect(drawn.filter((weight) => weight > 0).length).toBeLessThanOrEqual(51)
    // Halfway to the edge, half the weight.
    expect(drawn[49 + 12]).toBeCloseTo(1 - 12 / 25, 9)
    expect(drawn[49 - 12]).toBeCloseTo(drawn[49 + 12]!, 9)
  })

  it('dims no character where the loop starts over, so the restart never shows', () => {
    expect(weights(0).every((weight) => weight === 0)).toBe(true)
    expect(weights(0.9999).every((weight) => weight === 0)).toBe(true)
  })

  it('walks its deepest point from the first character to the last', () => {
    for (let index = 0; index < COUNT; index++) {
      const drawn = weights(centredOn(index))
      expect(drawn[index]).toBeCloseTo(1, 9)
      expect(drawn.indexOf(Math.max(...drawn))).toBe(index)
    }
  })

  it('takes a character at the band centre down to 10% of the label: the label at 10% alpha over the page', () => {
    expect(SHIMMER_BAND_ALPHA).toBe(0.1)
    expect(shimmerBandColor('#B8B4AB', '#1A1917')).toBe(mixHexColor('#B8B4AB', '#1A1917', 0.9))
    expect(shimmerBandColor('#B8B4AB', '#1A1917')).toBe('#2a2926')
  })

  for (const [scheme, palette] of [
    ['dark', darkColors],
    ['light', lightColors]
  ] as const) {
    it(`dims toward the page from the live palette, nearly to the page itself (${scheme})`, () => {
      const band = shimmerBandColor(palette.textSecondary, palette.bg)
      const label = luminance(palette.textSecondary)
      const page = luminance(palette.bg)
      // 90% of the way from the label to the page.
      expect(Math.abs(luminance(band) - page)).toBeCloseTo(Math.abs(label - page) * 0.1, -1)
      expect(Math.sign(luminance(band) - label)).toBe(Math.sign(page - label))
    })
  }

  it('still steps the sweep 40 times a second instead of on every display frame', () => {
    expect(SHIMMER_FRAMES_PER_SECOND).toBe(40)
    const steps = new Set(Array.from({ length: 1500 }, (_, ms) => shimmerFramePhase(ms / 1500)))
    expect(steps.size).toBe((SHIMMER_PERIOD_MS / 1000) * SHIMMER_FRAMES_PER_SECOND)
    expect(shimmerFramePhase(1)).toBe(0)
  })

  it('still sweeps a one-character label, and draws nothing for an empty one or a stray index', () => {
    expect(shimmerBandWeight(0.5, 0, 1)).toBeCloseTo(1, 9)
    expect(shimmerBandWeight(0, 0, 1)).toBe(0)
    expect(shimmerBandWeight(0.5, 0, 0)).toBe(0)
    expect(shimmerBandWeight(0.5, -1, COUNT)).toBe(0)
    expect(shimmerBandWeight(0.5, COUNT, COUNT)).toBe(0)
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
