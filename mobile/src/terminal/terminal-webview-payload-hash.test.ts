import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { XTERM_HTML } from './terminal-webview-html'

// Why: every other WebView test exercises one slice of the document, so an edit to an
// uncovered region ships silently. A diff here means the emitted WebView source changed —
// update these values only when that change is deliberate, and only after checking the
// document still runs. Refactors that merely move slice boundaries must leave them alone.
// Last deliberate change: an explicit desktop-published minimumContrastRatio (#10754)
// now wins over the background-luminance gate, clamped to xterm's 1-21 range.
const EXPECTED_SHA256 = '6b5cae90a4b0ebda4fa2f1cdb3fd53880ffca5550f1dcaa6e1c0d613a4b3d75c'
const EXPECTED_LENGTH = 750102

describe('terminal WebView payload', () => {
  it('composes the expected document', () => {
    expect(XTERM_HTML.length).toBe(EXPECTED_LENGTH)
    expect(createHash('sha256').update(XTERM_HTML, 'utf8').digest('hex')).toBe(EXPECTED_SHA256)
  })
})
