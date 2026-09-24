import { describe, expect, it } from 'vitest'
import {
  EMPTY_MARKUP_STROKE_STATE,
  canRedoMarkupStroke,
  canUndoMarkupStroke,
  commitMarkupStroke,
  hasMarkupStrokes,
  redoMarkupStroke,
  resolveMarkupCloseAction,
  undoMarkupStroke,
  type MarkupStroke
} from './image-markup-strokes'

// Claude app markup flow (2026-09-24): draw with a red pen, undo/redo the
// strokes, and closing with marks up asks "Discard markup?" first. This is
// the stroke list + undo/redo stack behind that screen, kept free of any RN
// or gesture-handler import so it can be tested without a device.

const A: MarkupStroke = { points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }
const B: MarkupStroke = { points: [{ x: 5, y: 5 }, { x: 15, y: 15 }, { x: 20, y: 5 }] }

describe('the markup stroke list a finger draws', () => {
  it('starts empty, with nothing to undo or redo', () => {
    expect(EMPTY_MARKUP_STROKE_STATE.strokes).toEqual([])
    expect(canUndoMarkupStroke(EMPTY_MARKUP_STROKE_STATE)).toBe(false)
    expect(canRedoMarkupStroke(EMPTY_MARKUP_STROKE_STATE)).toBe(false)
    expect(hasMarkupStrokes(EMPTY_MARKUP_STROKE_STATE)).toBe(false)
  })

  it('commits a finished stroke and can undo it back off the canvas', () => {
    const drawn = commitMarkupStroke(EMPTY_MARKUP_STROKE_STATE, A)
    expect(drawn.strokes).toEqual([A])
    expect(canUndoMarkupStroke(drawn)).toBe(true)

    const undone = undoMarkupStroke(drawn)
    expect(undone.strokes).toEqual([])
    expect(canUndoMarkupStroke(undone)).toBe(false)
    expect(canRedoMarkupStroke(undone)).toBe(true)
  })

  it('redo restores exactly the stroke undo just removed, in order', () => {
    const withTwo = commitMarkupStroke(commitMarkupStroke(EMPTY_MARKUP_STROKE_STATE, A), B)
    const undoneOnce = undoMarkupStroke(withTwo)
    expect(undoneOnce.strokes).toEqual([A])

    const redone = redoMarkupStroke(undoneOnce)
    expect(redone.strokes).toEqual([A, B])
    expect(canRedoMarkupStroke(redone)).toBe(false)
  })

  it('a fresh stroke after an undo throws away whatever redo would have restored', () => {
    const withTwo = commitMarkupStroke(commitMarkupStroke(EMPTY_MARKUP_STROKE_STATE, A), B)
    const undoneOnce = undoMarkupStroke(withTwo)
    expect(canRedoMarkupStroke(undoneOnce)).toBe(true)

    const drewSomethingElse = commitMarkupStroke(undoneOnce, {
      points: [{ x: 1, y: 1 }, { x: 2, y: 2 }]
    })
    expect(canRedoMarkupStroke(drewSomethingElse)).toBe(false)
    expect(drewSomethingElse.strokes).toEqual([A, { points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }])
  })

  it('undoing with nothing drawn is a no-op, not an error', () => {
    expect(undoMarkupStroke(EMPTY_MARKUP_STROKE_STATE)).toBe(EMPTY_MARKUP_STROKE_STATE)
  })

  it('redoing with nothing undone is a no-op', () => {
    const drawn = commitMarkupStroke(EMPTY_MARKUP_STROKE_STATE, A)
    expect(redoMarkupStroke(drawn)).toBe(drawn)
  })

  // A tap that never dragged has one point (or none) and draws no visible
  // line — the Claude app's pen does not leave a dot on a tap.
  it('drops a stroke with fewer than two points instead of committing a dot', () => {
    const tapped = commitMarkupStroke(EMPTY_MARKUP_STROKE_STATE, { points: [{ x: 4, y: 4 }] })
    expect(tapped).toBe(EMPTY_MARKUP_STROKE_STATE)
    const empty = commitMarkupStroke(EMPTY_MARKUP_STROKE_STATE, { points: [] })
    expect(empty).toBe(EMPTY_MARKUP_STROKE_STATE)
  })

  it('keeps a straight two-point stroke — the shortest real line', () => {
    const drawn = commitMarkupStroke(EMPTY_MARKUP_STROKE_STATE, A)
    expect(drawn.strokes).toEqual([A])
  })
})

describe('closing the editor', () => {
  it('closes at once with a clean canvas', () => {
    expect(resolveMarkupCloseAction(EMPTY_MARKUP_STROKE_STATE)).toBe('close')
  })

  it('asks to discard once a stroke is on the canvas', () => {
    const drawn = commitMarkupStroke(EMPTY_MARKUP_STROKE_STATE, A)
    expect(resolveMarkupCloseAction(drawn)).toBe('confirm-discard')
  })

  it('closes at once again after every stroke is undone off the canvas', () => {
    const drawn = commitMarkupStroke(EMPTY_MARKUP_STROKE_STATE, A)
    const undone = undoMarkupStroke(drawn)
    expect(resolveMarkupCloseAction(undone)).toBe('close')
  })
})
