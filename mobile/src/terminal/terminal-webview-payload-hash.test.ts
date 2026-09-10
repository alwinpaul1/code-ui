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
// Then: momentum got its own frame-step cap. The settle keeps 16ms; a fling
// must not have ordinary frame variance clamped out of its clock.
// Then: agent output is held out of xterm's parser while a finger is
// scrolling, because write() parses and repaints on the same WebView thread
// that owes the finger its frames.
// Then: the write hold wakes its own pump when the cap expires, or a resize's
// re-serialised buffer could sit in the queue forever and leave a blank view.
const EXPECTED_SHA256 = '0e28ba7e2d66d389f01087164e3e82e5cbfac60bcbd6042c55fbb62b9f4c8df0'
const EXPECTED_LENGTH = 757011

describe('terminal WebView payload', () => {
  it('composes the expected document', () => {
    expect(XTERM_HTML.length).toBe(EXPECTED_LENGTH)
    expect(createHash('sha256').update(XTERM_HTML, 'utf8').digest('hex')).toBe(EXPECTED_SHA256)
  })
})
