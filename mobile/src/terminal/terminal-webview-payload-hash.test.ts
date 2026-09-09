import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { XTERM_HTML } from './terminal-webview-html'

// Why: every other WebView test exercises one slice of the document, so an edit to an
// uncovered region ships silently. A diff here means the emitted WebView source changed —
// update these values only when that change is deliberate, and only after checking the
// document still runs. Refactors that merely move slice boundaries must leave them alone.
// Last deliberate change: sub-row touch scrolling — fractional compositor transform on
// .xterm-screen, time-based fling, touch-action: none, cached gesture layout reads.
const EXPECTED_SHA256 = '60531b9159fdc67a9fd68134f2eace00126379ddd7b7d83922d67ca590efd9ce'
const EXPECTED_LENGTH = 746955

describe('terminal WebView payload', () => {
  it('composes the expected document', () => {
    expect(XTERM_HTML.length).toBe(EXPECTED_LENGTH)
    expect(createHash('sha256').update(XTERM_HTML, 'utf8').digest('hex')).toBe(EXPECTED_SHA256)
  })
})
