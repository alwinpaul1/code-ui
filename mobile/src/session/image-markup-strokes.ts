/** The stroke list behind the Claude-app-style markup editor: a finger drags
 *  a red pen across an attached screenshot before it is sent. Kept free of
 *  React Native and gesture-handler so the undo/redo/discard logic is
 *  testable without a device — the editor component owns the gesture and
 *  the SVG, this owns only what got drawn. */

/** A point in the IMAGE's own natural-pixel coordinate space (not the
 *  screen's displayed size), so a stroke lands in the same spot on the photo
 *  whether the box is small or the phone is rotated. */
export type MarkupPoint = { readonly x: number; readonly y: number }

export type MarkupStroke = { readonly points: readonly MarkupPoint[] }

export type MarkupStrokeState = {
  readonly strokes: readonly MarkupStroke[]
  readonly redoStack: readonly MarkupStroke[]
}

export const EMPTY_MARKUP_STROKE_STATE: MarkupStrokeState = { strokes: [], redoStack: [] }

/** Commits a finger's finished drag to the canvas and clears the redo stack
 *  — drawing something new after an undo throws away whatever a redo would
 *  have restored, the same as any editor. A stroke with fewer than two
 *  points (a tap that never dragged) draws no visible line and is dropped. */
export function commitMarkupStroke(state: MarkupStrokeState, stroke: MarkupStroke): MarkupStrokeState {
  if (stroke.points.length < 2) {
    return state
  }
  return { strokes: [...state.strokes, stroke], redoStack: [] }
}

export function undoMarkupStroke(state: MarkupStrokeState): MarkupStrokeState {
  if (state.strokes.length === 0) {
    return state
  }
  const undone = state.strokes[state.strokes.length - 1]!
  return { strokes: state.strokes.slice(0, -1), redoStack: [...state.redoStack, undone] }
}

export function redoMarkupStroke(state: MarkupStrokeState): MarkupStrokeState {
  if (state.redoStack.length === 0) {
    return state
  }
  const restored = state.redoStack[state.redoStack.length - 1]!
  return { strokes: [...state.strokes, restored], redoStack: state.redoStack.slice(0, -1) }
}

export function canUndoMarkupStroke(state: MarkupStrokeState): boolean {
  return state.strokes.length > 0
}

export function canRedoMarkupStroke(state: MarkupStrokeState): boolean {
  return state.redoStack.length > 0
}

export function hasMarkupStrokes(state: MarkupStrokeState): boolean {
  return state.strokes.length > 0
}

/** Closing the editor: a clean canvas closes at once, a marked-up one asks
 *  first — the Claude app's "Discard markup?" (2026-09-24). */
export type MarkupCloseAction = 'close' | 'confirm-discard'

export function resolveMarkupCloseAction(state: MarkupStrokeState): MarkupCloseAction {
  return hasMarkupStrokes(state) ? 'confirm-discard' : 'close'
}
