/** Percent stops for the usage scale: calm at 0, warning by 70, danger at 90. */
export const USAGE_COLOR_STOPS: readonly [number, number, number] = [0, 70, 90]

export type UsageColorStops = { success: string; warning: string; danger: string }

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean
  const n = Number.parseInt(full.slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  const channel = (x: number, y: number) => Math.round(x + (y - x) * t)
  return `#${[channel(ar, br), channel(ag, bg), channel(ab, bb)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`
}

/**
 * The colour for a usage percentage, continuous rather than stepped: green at
 * 0, sliding to amber by 70 and to red by 90, so 18%, 34% and 55% already
 * read as different shades instead of one flat blue below the first threshold.
 * The animated ring and bars use Reanimated's interpolateColor over the same
 * stops; this is the same scale for anything static, and for tests.
 */
export function usageColor(percent: number, stops: UsageColorStops): string {
  const pct = Math.max(0, Math.min(100, percent))
  const [calm, warn, hot] = USAGE_COLOR_STOPS
  if (pct <= calm) {
    return stops.success
  }
  if (pct < warn) {
    return mix(stops.success, stops.warning, (pct - calm) / (warn - calm))
  }
  if (pct < hot) {
    return mix(stops.warning, stops.danger, (pct - warn) / (hot - warn))
  }
  return stops.danger
}
