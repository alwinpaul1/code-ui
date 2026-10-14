import { describe, expect, it } from 'vitest'
import { composerFieldFoldStyle, nextComposerFieldHeight } from './composer-field-fold'

/**
 * 0.9.140 on the phone (2026-10-14): after a dictation take the composer's field was gone, or
 * cropped to one line with the draft scrolled out of sight. The fold pinned the field to the last
 * height it measured, and a layout taken while the row was up (0, or the height before the dictated
 * text grew the draft) stayed pinned once the row went away. The fold's sums run on the UI thread,
 * where a test renderer never re-runs them, so they are pinned here as plain functions.
 */
describe("the composer field's fold", () => {
  it('leaves the idle field at its natural height, never a measured one, so a grown draft is not cropped', () => {
    const idle = composerFieldFoldStyle(0, 48)
    expect(idle).toEqual({ opacity: 1, height: 'auto' })
  })

  it('does not remember a height measured while the row was up', () => {
    expect(nextComposerFieldHeight(48, 0, 1)).toBe(48)
    expect(nextComposerFieldHeight(48, 20, 0.5)).toBe(48)
  })

  it('remembers a height measured while the field is fully open', () => {
    expect(nextComposerFieldHeight(48, 96, 0)).toBe(96)
    expect(nextComposerFieldHeight(-1, 48, 0)).toBe(48)
  })

  it('folds from the remembered height while the row comes up', () => {
    expect(composerFieldFoldStyle(0.5, 48)).toEqual({ opacity: 0.5, height: 24 })
    expect(composerFieldFoldStyle(1, 48)).toEqual({ opacity: 0, height: 0 })
  })

  it('fades without folding before the first layout', () => {
    expect(composerFieldFoldStyle(0.5, -1)).toEqual({ opacity: 0.5, height: 'auto' })
    expect(composerFieldFoldStyle(0, -1)).toEqual({ opacity: 1, height: 'auto' })
  })
})
