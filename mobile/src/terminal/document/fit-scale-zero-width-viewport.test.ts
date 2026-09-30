// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTerminalDocumentScope, type TerminalDocumentScope } from './document-scope'
import { computeFitScale } from './viewport-transform'

// The terminal drew blank after its page was measured at zero width (a WebView laid out while
// collapsed or hidden, or a resize to width 0): the fit scale came out as innerWidth / termWidth =
// 0, commitFitScale stored it (the >= 0.95 snap does not reach 0), and updateTransform wrote
// scale(0) until a later resize (review, 2026-09-30). Whether Android's WebView really reports a
// zero width is unconfirmed; a viewport with no width now changes nothing.

/** A scope over an 80-column grid of 8 px cells, 640 px wide, fitted earlier at `scale`. */
function fittedScope(scale: number): TerminalDocumentScope {
  const scope = createTerminalDocumentScope({ installHostTransport: () => () => {}, hasEngine: () => true })
  scope.term = {
    cols: 80,
    element: { scrollWidth: 640 },
    _core: { _renderService: { dimensions: { css: { cell: { width: 8, height: 16 } } } } }
  } as unknown as TerminalDocumentScope['term']
  scope.currentScale = scale
  return scope
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the terminal measured at zero width', () => {
  it('keeps the scale it had instead of collapsing to 0', () => {
    vi.stubGlobal('innerWidth', 0)
    expect(computeFitScale(fittedScope(0.5))).toBe(0.5)
    expect(computeFitScale(fittedScope(1))).toBe(1)
  })

  it('keeps it for a negative or unreadable width too', () => {
    vi.stubGlobal('innerWidth', -10)
    expect(computeFitScale(fittedScope(0.5))).toBe(0.5)
    vi.stubGlobal('innerWidth', Number.NaN)
    expect(computeFitScale(fittedScope(0.5))).toBe(0.5)
  })

  it('still fits a grid wider than the viewport, and never scales one up past 1', () => {
    vi.stubGlobal('innerWidth', 320)
    expect(computeFitScale(fittedScope(1))).toBe(0.5)
    vi.stubGlobal('innerWidth', 1280)
    expect(computeFitScale(fittedScope(0.5))).toBe(1)
  })

  it('still answers 1 for a grid with no width yet, whatever the viewport', () => {
    vi.stubGlobal('innerWidth', 0)
    const scope = fittedScope(0.5)
    scope.term = { cols: 80, element: { scrollWidth: 0 } } as unknown as TerminalDocumentScope['term']
    expect(computeFitScale(scope)).toBe(1)
  })
})
