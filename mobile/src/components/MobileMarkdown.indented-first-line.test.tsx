import { describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'

vi.mock('react-native', () => ({
  Linking: { openURL: () => Promise.resolve() },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light',
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 }
}))
vi.mock('./pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))

import { MobileMarkdown } from './MobileMarkdown'
import { MobileMarkdownCodeChip } from './MobileMarkdownCodeChip'
import { ThemeProvider } from '../theme/theme-context'
import { fontFamily } from '../theme/tokens'

// Review, 2026-09-30: MobileMarkdown trimmed its document before the HTML
// pass, and the trim took the first line's indent, so a reply that opens with
// an indented code block drew `<div>x</div>` as `x` and `&amp;` as `&`, in a
// paragraph. The same block after a paragraph drew as code. The Copy of it is
// pinned in markdown-plain-text.test.ts.

const SCHEMES = ['light', 'dark'] as const

function render(content: string, scheme: 'light' | 'dark'): ReactTestRenderer {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileMarkdown content={content} fallback="Nothing here." />
      </ThemeProvider>
    )
  })
  return renderer
}

function textOf(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map(textOf).join('')
}

function stylesOf(style: unknown): Record<string, unknown>[] {
  if (Array.isArray(style)) {
    return style.flatMap(stylesOf)
  }
  return style && typeof style === 'object' ? [style as Record<string, unknown>] : []
}

/** The text drawn in the code face, the way a code block draws its lines. */
function codeText(renderer: ReactTestRenderer): string {
  return renderer.root
    .findAllByType('Text' as never)
    .filter((node) => stylesOf(node.props.style).some((style) => style.fontFamily === fontFamily.mono))
    .filter((node) => !node.parent || node.parent.type !== ('Text' as never) || !stylesOf(node.parent.props.style).some((style) => style.fontFamily === fontFamily.mono))
    .map(textOf)
    .join('\n')
}

describe('a reply that opens with an indented code block', () => {
  it.each(SCHEMES)('draws its first line as code, tags and entities as written (%s)', (scheme) => {
    const renderer = render('    <div>x</div>\n    &amp; y', scheme)
    const code = codeText(renderer)
    expect(code).toContain('<div>x</div>')
    expect(code).toContain('&amp; y')
    expect(textOf(renderer.root)).not.toContain('x & y')
    act(() => renderer.unmount())
  })

  it.each(SCHEMES)('draws a one-line block after blank lines as code too (%s)', (scheme) => {
    const renderer = render('\n\n\t<b>x</b>', scheme)
    expect(codeText(renderer)).toContain('<b>x</b>')
    act(() => renderer.unmount())
  })

  it('draws the fallback for a document of only blank lines and spaces', () => {
    const renderer = render('\n    \n\t\n', 'light')
    expect(textOf(renderer.root)).toBe('Nothing here.')
    act(() => renderer.unmount())
  })

  it('still reads a first line indented less than four columns as prose', () => {
    const renderer = render('   <b>x</b> y', 'light')
    expect(textOf(renderer.root)).toBe('x y')
    expect(codeText(renderer)).toBe('')
    act(() => renderer.unmount())
  })

  // The document, first line's indent and all, also keys what the code
  // pills learn (use-markdown-code-pill-runs.ts): an indent it now keeps must
  // not cost a reply its pills.
  it('still cuts a code pill in a reply whose first line is indented or follows blank lines', () => {
    for (const content of ['\n\nrun `npm test` now', '  run `npm test` now']) {
      const renderer = render(content, 'light')
      const chips = renderer.root.findAllByType(MobileMarkdownCodeChip)
      expect(chips.map((chip) => chip.props.span), content).toEqual(['npm test'])
      act(() => renderer.unmount())
    }
  })
})
