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

export function markupPenWidth(naturalWidth: number): number {
  return Math.max(MARKUP_PEN_MIN_WIDTH_PX, naturalWidth * MARKUP_PEN_WIDTH_FRACTION)
}
