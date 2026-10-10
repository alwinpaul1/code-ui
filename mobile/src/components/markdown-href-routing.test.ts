import { describe, expect, it } from 'vitest'
import { routeMarkdownHref } from './markdown-href-routing'
import {
  createNativeChatFileHref,
  routeNativeChatHref
} from '../../../src/shared/native-chat-href-routing'

describe('routeMarkdownHref', () => {
  it('routes web and mail links to the system handler', () => {
    expect(routeMarkdownHref('https://example.com/docs')).toEqual({
      kind: 'web',
      url: 'https://example.com/docs'
    })
    expect(routeMarkdownHref('http://localhost:3000/')).toEqual({
      kind: 'web',
      url: 'http://localhost:3000/'
    })
    expect(routeMarkdownHref(' mailto:dev@example.com ')).toEqual({
      kind: 'web',
      url: 'mailto:dev@example.com'
    })
  })

  it('routes relative hrefs to the file opener', () => {
    expect(routeMarkdownHref('src/foo.ts')).toEqual({ kind: 'file', pathText: 'src/foo.ts' })
    expect(routeMarkdownHref('./docs/plan.md')).toEqual({
      kind: 'file',
      pathText: './docs/plan.md'
    })
  })

  it('carries a #L fragment as a :line suffix', () => {
    expect(routeMarkdownHref('docs/plan.md#L42')).toEqual({
      kind: 'file',
      pathText: 'docs/plan.md:42'
    })
    expect(routeMarkdownHref('docs/plan.md?plain=1#line-7')).toEqual({
      kind: 'file',
      pathText: 'docs/plan.md:7'
    })
    expect(routeMarkdownHref('docs/plan.md#usage')).toEqual({
      kind: 'file',
      pathText: 'docs/plan.md'
    })
  })

  it('decodes percent-encoded href paths', () => {
    expect(routeMarkdownHref('docs/release%20notes.md')).toEqual({
      kind: 'file',
      pathText: 'docs/release notes.md'
    })
  })

  it('preserves the existing wrapped reply-location contract', () => {
    expect(routeMarkdownHref(createNativeChatFileHref(' docs/report.md:12:4 '))).toEqual({
      kind: 'file',
      pathText: 'docs/report.md:12:4'
    })
  })

  // Code UI guard for the vendored #26511 half (upstream's shared test is not run here). The
  // phone joins a line back onto the path, so a literal tool path opens the same file either
  // way; what the shared router must keep is that the literal wrapper is never re-read as a
  // location or a scheme.
  it('reads a literal tool path as a file name with no line', () => {
    expect(routeNativeChatHref(createNativeChatFileHref('/repo/report:12', 'literal'))).toEqual({
      kind: 'file',
      pathText: '/repo/report:12',
      line: null,
      pathKind: 'literal'
    })
    expect(routeMarkdownHref(createNativeChatFileHref('https:notes.md', 'literal'))).toEqual({
      kind: 'file',
      pathText: 'https:notes.md'
    })
  })

  it('routes file: URIs to the file opener', () => {
    expect(routeMarkdownHref('file:///Users/me/wt/src/app.tsx')).toEqual({
      kind: 'file',
      pathText: '/Users/me/wt/src/app.tsx'
    })
    expect(routeMarkdownHref('file:///Users/me/wt/src/app.tsx#L12')).toEqual({
      kind: 'file',
      pathText: '/Users/me/wt/src/app.tsx:12'
    })
    expect(routeMarkdownHref('file:///C:/repo/src/index.ts')).toEqual({
      kind: 'file',
      pathText: 'C:/repo/src/index.ts'
    })
  })

  it('keeps Windows drive paths out of the scheme filter', () => {
    expect(routeMarkdownHref(String.raw`C:\repo\src\index.ts`)).toEqual({
      kind: 'file',
      pathText: String.raw`C:\repo\src\index.ts`
    })
  })

  it('drops anchors, unknown schemes, and empty hrefs', () => {
    expect(routeMarkdownHref('#section')).toEqual({ kind: 'none' })
    expect(routeMarkdownHref('')).toEqual({ kind: 'none' })
    expect(routeMarkdownHref('editor://file/x.ts')).toEqual({ kind: 'none' })
    expect(routeMarkdownHref('javascript:alert(1)')).toEqual({ kind: 'none' })
    expect(routeMarkdownHref('data:text/plain,hi')).toEqual({ kind: 'none' })
  })
})
