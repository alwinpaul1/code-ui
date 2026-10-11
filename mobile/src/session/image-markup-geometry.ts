import type { MarkupPoint, MarkupStroke } from './image-markup-strokes'

/** Geometry behind the markup editor's canvas: mapping a finger's touch
 *  (inside the box the photo is shown at, `contain` fit) onto the photo's
 *  own pixels, and turning a stroke into an SVG path. Pure and free of React
 *  Native so it is testable without a device; the editor component supplies
 *  the box size (from `containedSize`, already used by the zoomed image
 *  viewer) and the gesture's touch points. */

/** A touch at the edge of a fast drag can land a few pixels past the box —
 *  clamp it onto the photo rather than let the stroke run off the canvas the
 *  flatten renders, which would silently drop part of the mark. */
function clamp(value: number, max: number): number {
  return Math.min(max, Math.max(0, value))
}

export function displayPointToNatural(
  point: MarkupPoint,
  drawn: { width: number; height: number },
  natural: { width: number; height: number }
): MarkupPoint {
  if (!(drawn.width > 0) || !(drawn.height > 0)) {
    return { x: 0, y: 0 }
  }
  return {
    x: clamp((point.x / drawn.width) * natural.width, natural.width),
    y: clamp((point.y / drawn.height) * natural.height, natural.height)
  }
}

/** Two decimal places keeps a long freehand drag's path short without a
 *  visible kink — well under a screen pixel at any zoom this editor uses. */
function formatCoordinate(value: number): string {
  return String(Math.round(value * 100) / 100)
}

export function markupStrokePathData(stroke: MarkupStroke): string {
  if (stroke.points.length === 0) {
    return ''
  }
  const [first, ...rest] = stroke.points as [MarkupPoint, ...MarkupPoint[]]
  const move = `M${formatCoordinate(first.x)} ${formatCoordinate(first.y)}`
  const lines = rest.map((point) => ` L${formatCoordinate(point.x)} ${formatCoordinate(point.y)}`)
  return move + lines.join('')
}

/** Fraction of the photo's own width the pen draws at, so it reads the same
 *  relative thickness on a phone snapshot and a hi-res screenshot alike. */
const MARKUP_PEN_WIDTH_FRACTION = 0.006
export const MARKUP_PEN_MIN_WIDTH_PX = 4

/** The Claude app's pen (com.anthropic.claude 1.261009.20, decompiled
 *  2026-10-11): one colour, 8 dp wide at the size the picture is drawn on
 *  screen. */
export const MARKUP_PEN_COLOR = '#B93535'
const MARKUP_PEN_DP = 8
/** Done writes the picture with its longest side at most this. */
const MARKUP_OUTPUT_MAX_PX = 2000

/** The pen's width in the picture's own pixels: 8 dp at the width it is drawn
 *  on screen. Before the drawn width is known, a fraction of the picture's. */
export function markupPenWidth(naturalWidth: number, drawnWidth?: number): number {
  if (drawnWidth !== undefined && drawnWidth > 0 && naturalWidth > 0) {
    return (MARKUP_PEN_DP * naturalWidth) / drawnWidth
  }
  return Math.max(MARKUP_PEN_MIN_WIDTH_PX, naturalWidth * MARKUP_PEN_WIDTH_FRACTION)
}

/** The size Done writes: the picture's own, scaled down so its longest side
 *  is at most 2000 px, as the Claude app does. */
export function markupOutputSize(natural: { width: number; height: number }): { width: number; height: number } {
  const longest = Math.max(natural.width, natural.height)
  const scale = longest > MARKUP_OUTPUT_MAX_PX ? MARKUP_OUTPUT_MAX_PX / longest : 1
  return { width: Math.round(natural.width * scale), height: Math.round(natural.height * scale) }
}
