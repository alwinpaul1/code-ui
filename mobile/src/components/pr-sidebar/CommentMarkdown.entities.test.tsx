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
vi.mock('lucide-react-native', () => ({ ChevronDown: 'ChevronDown', ChevronRight: 'ChevronRight' }))
vi.mock('./MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))

import { CommentMarkdown } from './CommentMarkdown'
import { ThemeProvider } from '../../theme/theme-context'

// Review, 2026-09-30: a PR comment drew 'Vec&lt;T&gt;' as written. The parse
// is pinned in markdown-entities.test.ts.

const SCHEMES = ['light', 'dark'] as const

function render(content: string, scheme: 'light' | 'dark'): ReactTestRenderer {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <CommentMarkdown content={content} />
      </ThemeProvider>
    )
  })
  return renderer
}

function textOf(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map(textOf).join('')
}

describe('HTML entities in a PR comment', () => {
  it.each(SCHEMES)('draws the characters, and keeps them in code (%s)', (scheme) => {
    const renderer = render('Use Vec&lt;T&gt; &amp; R&amp;D, not `Vec&lt;T&gt;`, see [a &amp; b](https://x.dev)', scheme)
    expect(textOf(renderer.root)).toBe('Use Vec<T> & R&D, not Vec&lt;T&gt;, see a & b')
    act(() => renderer.unmount())
  })

  it.each(SCHEMES)('draws them in a table cell and a list item (%s)', (scheme) => {
    const renderer = render('| T |\n|---|\n| Vec&lt;T&gt; |\n\n- a &amp; b', scheme)
    expect(textOf(renderer.root)).toBe('TVec<T>•a & b')
    act(() => renderer.unmount())
  })
})
