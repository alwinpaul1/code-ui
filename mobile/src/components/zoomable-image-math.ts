/**
 * The arithmetic behind pinch-to-zoom, kept pure so it can be tested without
 * a gesture runtime. Every function is a worklet: the gesture handlers call
 * them on the UI thread.
 *
 * The transform is `[{translateX}, {translateY}, {scale}]` about the box's
 * centre, so a content point `p` (relative to the centre) lands at
 * `translate + p * scale`.
 */
export const ZOOM_MIN = 1
/** Far enough to read small text in a figure; past it the bitmap is mush. */
export const ZOOM_MAX = 6
/** What a double tap zooms to. */
export const ZOOM_DOUBLE_TAP = 2.5

export type Point = { x: number; y: number }

/** The size the image is drawn at inside a box, `contain` fit. */
export function containedSize(
  box: { width: number; height: number },
  aspectRatio: number
): { width: number; height: number } {
  'worklet'
  if (!(box.width > 0) || !(box.height > 0) || !(aspectRatio > 0)) {
    return { width: Math.max(0, box.width), height: Math.max(0, box.height) }
  }
  const boxRatio = box.width / box.height
  return aspectRatio >= boxRatio
    ? { width: box.width, height: box.width / aspectRatio }
    : { width: box.height * aspectRatio, height: box.height }
}

export function clampScale(scale: number): number {
  'worklet'
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale))
}

/** Keep the zoomed image covering the box: no gap opens on a side that the
 *  image is big enough to fill, and an image smaller than the box on an axis
 *  stays centred on it. */
export function clampTranslation(
  translation: Point,
  drawn: { width: number; height: number },
  box: { width: number; height: number },
  scale: number
): Point {
  'worklet'
  const maxX = Math.max(0, (drawn.width * scale - box.width) / 2)
  const maxY = Math.max(0, (drawn.height * scale - box.height) / 2)
  // `+ 0` folds a -0 (from clamping to a zero slack) into 0.
  return {
    x: Math.min(maxX, Math.max(-maxX, translation.x)) + 0,
    y: Math.min(maxY, Math.max(-maxY, translation.y)) + 0
  }
}

/** The translation that keeps the point under the fingers (or the tap) where
 *  it is while the scale changes from `fromScale` to `toScale`. `focal` is
 *  relative to the box's centre. */
export function translationKeepingFocal(
  focal: Point,
  saved: Point,
  fromScale: number,
  toScale: number
): Point {
  'worklet'
  const k = fromScale > 0 ? toScale / fromScale : 1
  return {
    x: focal.x - (focal.x - saved.x) * k,
    y: focal.y - (focal.y - saved.y) * k
  }
}

/** Where a double tap takes the view: back to fit when zoomed at all, else
 *  in on the tapped point. */
export function doubleTapTarget(
  scale: number,
  focal: Point,
  drawn: { width: number; height: number },
  box: { width: number; height: number }
): { scale: number; translation: Point } {
  'worklet'
  if (scale > ZOOM_MIN + 0.01) {
    return { scale: ZOOM_MIN, translation: { x: 0, y: 0 } }
  }
  const translation = translationKeepingFocal(focal, { x: 0, y: 0 }, ZOOM_MIN, ZOOM_DOUBLE_TAP)
  return { scale: ZOOM_DOUBLE_TAP, translation: clampTranslation(translation, drawn, box, ZOOM_DOUBLE_TAP) }
}
