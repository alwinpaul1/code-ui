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

// Review, 2026-09-30: code the HTML pass should have left alone was
// rewritten, so a tag in it drew as `**x**` in a code block, or as bold in a
// code span. An indented block after a heading that ended a list, or after a
// quote ending in a fence (markdown-code-ranges.ts), and a code span across
// a line break (mobile-markdown-preview-html.ts). The Copy of each is pinned
// in markdown-plain-text.test.ts.

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

describe('code the HTML pass must leave as written', () => {
  it.each(SCHEMES)('draws an indented block after a heading that ended a list with its tags (%s)', (scheme) => {
    const renderer = render('- item\n# Next\n\n    <b>x</b>', scheme)
    expect(textOf(renderer.root)).toContain('<b>x</b>')
    expect(textOf(renderer.root)).not.toContain('**x**')
    act(() => renderer.unmount())
  })

  it.each(SCHEMES)('draws an indented block after a quote that ends in a fence with its tags (%s)', (scheme) => {
    const renderer = render('> ```\n> x\n> ```\n    <b>x</b>', scheme)
    expect(textOf(renderer.root)).toContain('<b>x</b>')
    expect(textOf(renderer.root)).not.toContain('**x**')
    act(() => renderer.unmount())
  })
})
