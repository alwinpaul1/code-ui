import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { XTERM_HTML } from './terminal-webview-html'

// Why: every other WebView test exercises one slice of the document, so an edit to an
// uncovered region ships silently. A diff here means the emitted WebView source changed —
// update these values only when that change is deliberate, and only after checking the
// document still runs. Refactors that merely move slice boundaries must leave them alone.
// Last deliberate change: the buffer ends bend and spring back instead of
// refusing to move (UIScrollView's f(x,d,c) = x*d*c/(d+c*x), c = 0.55). The
// bend is visual only — no row is committed and the spring returns the offset
// to exactly 0, so the at-rest row-boundary invariant is unchanged.
// Then: the overscroll dimension comes from rows x cell height instead of
// reading clientHeight, which forced layout on every frame of a pull.
const EXPECTED_SHA256 = 'b86b1e1591fd9655c16db8fcda1419cc7339a80c52a8c53c351d5ef608a759e8'
const EXPECTED_LENGTH = 753387

describe('terminal WebView payload', () => {
  it('composes the expected document', () => {
    expect(XTERM_HTML.length).toBe(EXPECTED_LENGTH)
    expect(createHash('sha256').update(XTERM_HTML, 'utf8').digest('hex')).toBe(EXPECTED_SHA256)
  })
})
