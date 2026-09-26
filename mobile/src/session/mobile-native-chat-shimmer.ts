// ─── The Claude app's running-label shimmer ──────────────────────────────────
//
// A still-running row ("◇ Running agent ›", "Running") keeps its icon and
// chevron still, and a darker band sweeps left to right across the label.
// Measured 2026-09-26 from the user's screen recording of the Claude app
// (1080x2316, resampled to 50 fps, glyph by glyph):
//
//   - one sweep every 1.50 s, at a constant 230 px/s, about 12 characters a
//     second across "Running agent";
//   - a triangle: about six characters wide at its foot, 3.4 at half depth;
//   - at its centre a glyph keeps 26% of its contrast against the page
//     (text 160, band 57, page 21 in 8-bit grey); everything else stays at
//     the label's normal colour;
//   - no gap to speak of between sweeps (0.06 s), and the icon and chevron
//     never change.
//
// The band's centre travels from half a band before the first character to
// half a band past the last, so a sweep starts and ends with nothing dimmed
// and the loop has no seam.

/** One sweep, start to end. */
export const SHIMMER_PERIOD_MS = 1500

/** Half the band's width at its foot, in characters. */
export const SHIMMER_HALF_BAND = 3

/** How far the band's centre takes a glyph toward the page: the 74% that
 *  leaves it the recording's 26% of its contrast. */
export const SHIMMER_BAND_DEPTH = 0.74

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

/**
 * How much the band covers character `index` of `count` at `phase` (one sweep
 * is 0 to 1; whole numbers wrap): 1 under the band's centre, falling off in a
 * straight line to 0 half a band away. A worklet, so each glyph's colour runs
 * on the UI thread from the one shared phase.
 */
export function shimmerBandWeight(phase: number, index: number, count: number): number {
  'worklet'
  if (count <= 0 || index < 0 || index >= count) {
    return 0
  }
  const sweep = phase - Math.floor(phase)
  const centre = -SHIMMER_HALF_BAND + sweep * (count + 2 * SHIMMER_HALF_BAND)
  const distance = Math.abs(index + 0.5 - centre)
  return Math.max(0, 1 - distance / SHIMMER_HALF_BAND)
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
 * The band's colour: the label sunk three quarters of the way into the page.
 * Darker than the label in dark mode, lighter in light mode, from the live
 * theme either way. A colour this cannot read leaves the label its own colour:
 * the sweep goes invisible and the label stays readable.
 */
export function shimmerBandColor(label: string, page: string): string {
  return mixHexColor(label, page, SHIMMER_BAND_DEPTH) ?? label
}
