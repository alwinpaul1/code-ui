import { describe, expect, it } from 'vitest'
import { isRemoteImageUrl, resolveMarkdownImagePath, svgAspectRatio } from './markdown-image-source'

describe('where a document’s image lives', () => {
  // thesis_explained.md sits in scratchpad/thesis_explained/ and names
  // `![CKA twins](fig/fig3_cka.svg)`; the phone showed a link, not the figure
  // (reported 2026-09-19 with a screenshot).
  it('resolves a relative path beside the document', () => {
    expect(
      resolveMarkdownImagePath('scratchpad/thesis_explained/thesis_explained.md', 'fig/fig3_cka.svg')
    ).toBe('scratchpad/thesis_explained/fig/fig3_cka.svg')
  })

  it('walks up with .., strips ./, a query and a fragment, and decodes %20', () => {
    expect(resolveMarkdownImagePath('docs/a/b.md', '../img/plot.png?v=2#x')).toBe('docs/img/plot.png')
    expect(resolveMarkdownImagePath('docs/a/b.md', './my%20plot.png')).toBe('docs/a/my plot.png')
    expect(resolveMarkdownImagePath('README.md', 'img/a.png')).toBe('img/a.png')
    expect(resolveMarkdownImagePath('README.md', '/img/a.png')).toBe('img/a.png')
  })

  it('keeps a figure named with a bare percent sign as written, rather than throwing', () => {
    // Review 2026-09-30: decodeURIComponent('100%.png') throws URIError: URI malformed, out of
    // the figure's effect, which took the document viewer down instead of drawing the link.
    expect(resolveMarkdownImagePath('docs/README.md', '100%.png')).toBe('docs/100%.png')
    expect(resolveMarkdownImagePath('docs/README.md', '50%off.png')).toBe('docs/50%off.png')
    expect(resolveMarkdownImagePath('README.md', '%')).toBe('%')
    // An encoded name still decodes, part by part, beside one that does not.
    expect(resolveMarkdownImagePath('README.md', 'my%20figs/100%.png')).toBe('my figs/100%.png')
  })

  it('refuses a path that leaves the worktree, and a URL that is not a file', () => {
    expect(resolveMarkdownImagePath('docs/a.md', '../../etc/passwd')).toBeNull()
    expect(resolveMarkdownImagePath('a.md', '..')).toBeNull()
    expect(resolveMarkdownImagePath('a.md', 'https://x.test/a.png')).toBeNull()
    expect(resolveMarkdownImagePath('a.md', 'data:image/png;base64,AAAA')).toBeNull()
    expect(resolveMarkdownImagePath('a.md', 'mailto:x@y')).toBeNull()
    expect(resolveMarkdownImagePath('a.md', '')).toBeNull()
  })

  it('knows which URLs the phone can draw without the host', () => {
    expect(isRemoteImageUrl('https://x.test/a.png')).toBe(true)
    expect(isRemoteImageUrl('//cdn.test/a.png')).toBe(true)
    expect(isRemoteImageUrl('data:image/png;base64,AAAA')).toBe(true)
    expect(isRemoteImageUrl('fig/a.png')).toBe(false)
  })
})

describe('an SVG’s shape', () => {
  it('comes from its viewBox, then its width/height, then a 16:9 guess', () => {
    expect(svgAspectRatio('<svg viewBox="0 0 800 400"></svg>')).toBe(2)
    expect(svgAspectRatio('<svg xmlns="x" width="300px" height="150"></svg>')).toBe(2)
    expect(svgAspectRatio('<svg></svg>')).toBeCloseTo(16 / 9)
    expect(svgAspectRatio('<svg viewBox="0 0 0 0"></svg>')).toBeCloseTo(16 / 9)
  })
})
