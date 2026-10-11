// ─── The Claude app's running-label shimmer ──────────────────────────────────
//
// A still-running row ("Running agent: …", "Running") keeps its icon and
// chevron still, and a dimming band sweeps left to right across the label.
// The values are the Claude app's own, read from its code (1.261009.20,
// decompiled 2026-10-11; docs/claude-app-implementation-notes.md in the main
// checkout, "Shimmer"): the label's brush is a horizontal linear gradient of
// base, base at 10% alpha, base, centred on p * W with a half-width of
// 0.25 * W (W the text's width, so the band is half the text wide), and p runs
// from -0.25 to 1.25 on a 1500 ms linear tween that restarts. They replace the
// values measured off a screen recording on 2026-09-26 (a six-character band
// that left 26% of a glyph's contrast).
//
// This draws one span per glyph, so W is counted in glyphs and each glyph
// takes the band's value at its own centre. The band starts and ends a
// quarter of the width outside the text, so a sweep begins and ends with
// nothing dimmed and the restart has no seam.

/** One sweep, start to end: the tween's 1500 ms. */
export const SHIMMER_PERIOD_MS = 1500

/** Where the band's centre starts and ends, as a fraction of the text width. */
export const SHIMMER_SWEEP_FROM = -0.25
export const SHIMMER_SWEEP_TO = 1.25

/** Half the band's width, as a fraction of the text width. */
export const SHIMMER_BAND_HALF_WIDTH = 0.25

/** The label's alpha at the band's centre: base at 10% alpha. */
export const SHIMMER_BAND_ALPHA = 0.1

/** How often the glyph colours change. Each change is a Fabric commit (the
 *  clone to the label, Yoga, a new paragraph state, a new Spannable and
 *  setText on Android), so the sweep steps rather than following a 120 Hz
 *  display: 60 steps a sweep, the band about a third of a character further
 *  on each step, about nine steps across a glyph's ramp in or out. */
export const SHIMMER_FRAMES_PER_SECOND = 40

const SHIMMER_STEPS = (SHIMMER_PERIOD_MS / 1000) * SHIMMER_FRAMES_PER_SECOND

/** The phase held to the start of its step, so every display frame inside a
 *  step computes the same colours and Reanimated skips their commit (its
 *  styleUpdater updates nothing for a style shallowEqual to the last). */
export function shimmerFramePhase(phase: number): number {
  'worklet'
  const sweep = phase - Math.floor(phase)
  return Math.floor(sweep * SHIMMER_STEPS) / SHIMMER_STEPS
}

/** Where the band's centre is at `phase` (one sweep is 0 to 1; whole numbers
 *  wrap), as a fraction of the text width: -0.25 to 1.25, linear. */
export function shimmerBandCentre(phase: number): number {
  'worklet'
  const sweep = phase - Math.floor(phase)
  return SHIMMER_SWEEP_FROM + sweep * (SHIMMER_SWEEP_TO - SHIMMER_SWEEP_FROM)
}

/**
 * How much the band covers character `index` of `count` at `phase`: 1 under
 * the band's centre, falling off in a straight line (the gradient's stops) to
 * 0 a quarter of the width away. A worklet, so each glyph's colour runs on the
 * UI thread from the one shared phase.
 */
export function shimmerBandWeight(phase: number, index: number, count: number): number {
  'worklet'
  if (count <= 0 || index < 0 || index >= count) {
    return 0
  }
  const at = (index + 0.5) / count
  const distance = Math.abs(at - shimmerBandCentre(phase))
  return Math.max(0, 1 - distance / SHIMMER_BAND_HALF_WIDTH)
}

function parseHex(color: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (!match) {
    return null
  }
  const digits = match[1]!.length === 3 ? [...match[1]!].map((d) => d + d).join('') : match[1]!
  const value = Number.parseInt(digits, 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

/** `from` moved `amount` of the way to `to`, or null when either is not a
 *  plain #rgb / #rrggbb colour. */
export function mixHexColor(from: string, to: string, amount: number): string | null {
  const start = parseHex(from)
  const end = parseHex(to)
  if (!start || !end) {
    return null
  }
  const channel = (index: number) =>
    Math.round(start[index]! + (end[index]! - start[index]!) * amount)
      .toString(16)
      .padStart(2, '0')
  return `#${channel(0)}${channel(1)}${channel(2)}`
}

/**
 * The band's colour: the label at 10% alpha over the page, which is the label
 * moved 90% of the way to the page. Darker than the label in dark mode,
 * lighter in light mode, from the live theme either way. A colour this cannot
 * read leaves the label its own colour: the sweep goes invisible and the
 * label stays readable.
 */
export function shimmerBandColor(label: string, page: string): string {
  return mixHexColor(label, page, 1 - SHIMMER_BAND_ALPHA) ?? label
}
