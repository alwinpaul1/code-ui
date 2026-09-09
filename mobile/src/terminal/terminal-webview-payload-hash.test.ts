import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { XTERM_HTML } from './terminal-webview-html'

// Why: every other WebView test exercises one slice of the document, so an edit to an
// uncovered region ships silently. A diff here means the emitted WebView source changed —
// update these values only when that change is deliberate, and only after checking the
// document still runs. Refactors that merely move slice boundaries must leave them alone.
// Last deliberate change: the scroll remainder is rewritten from term.onRender (the frame
// xterm actually paints), unpainted rows ride on the transform, and a touchmove scrolls the
// buffer in its own frame instead of one animation frame later.
const EXPECTED_SHA256 = '4b1fc4fc5aa8a96d6332f86b2586c7da64e7379c011f8db715d7a1b0afb29408'
const EXPECTED_LENGTH = 749450

describe('terminal WebView payload', () => {
  it('composes the expected document', () => {
    expect(XTERM_HTML.length).toBe(EXPECTED_LENGTH)
    expect(createHash('sha256').update(XTERM_HTML, 'utf8').digest('hex')).toBe(EXPECTED_SHA256)
  })
})
