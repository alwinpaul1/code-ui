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
import { ThemeProvider } from '../theme/theme-context'

// Review, 2026-09-30 (two reviewers): a fence inside a quote reached the HTML
// pass, so the quote drew `**x** &` for `<b>x</b> &amp;` and a bare `a` for
// `<Text>a</Text>`. A quote draws a fence as its source (quotedText in
// mobile-markdown-parser.ts); what is pinned here is that its code arrives as
// written. The Copy is pinned in markdown-plain-text.test.ts.

const SCHEMES = ['light', 'dark'] as const

function render(content: string, scheme: 'light' | 'dark'): ReactTestRenderer {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileMarkdown content={content} />
      </ThemeProvider>
    )
  })
  return renderer
}

function textOf(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map(textOf).join('')
}

/** The text of the quote: the View with the bar down its side. */
function quoteText(renderer: ReactTestRenderer): string {
  const quotes = renderer.root.findAll(
    (node) => node.type === ('View' as never) && JSON.stringify(node.props.style ?? '').includes('borderLeftWidth')
  )
  expect(quotes).toHaveLength(1)
  return textOf(quotes[0]!)
}

describe('a fenced code block inside a quote', () => {
  it.each(SCHEMES)('draws its tags and entities as written (%s)', (scheme) => {
    const renderer = render('Before:\n\n> ```\n> <b>x</b> &amp;\n> ```\n\nAfter <b>bold</b>.', scheme)
    expect(quoteText(renderer)).toContain('<b>x</b> &amp;')
    // The prose after the quote still goes through the HTML pass.
    expect(textOf(renderer.root)).toContain('After bold.')
    act(() => renderer.unmount())
  })

  it.each(SCHEMES)('keeps a component tag in a language fence (%s)', (scheme) => {
    const renderer = render('> ```tsx\n> <Text>a</Text>\n> ```', scheme)
    expect(quoteText(renderer)).toContain('<Text>a</Text>')
    act(() => renderer.unmount())
  })
})
