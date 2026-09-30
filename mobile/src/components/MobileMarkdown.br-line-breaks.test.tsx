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

// Review, 2026-09-30: 'Name: Ada<br>Role: Admin' drew on one line, "Name: Ada
// Role: Admin". The parse and the Copy are pinned in
// markdown-br-line-breaks.test.ts.

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

describe('a <br> outside a table in a chat reply', () => {
  it.each(SCHEMES)('draws the break in a paragraph (%s)', (scheme) => {
    const renderer = render('Name: Ada<br>Role: Admin', scheme)
    expect(textOf(renderer.root)).toBe('Name: Ada\nRole: Admin')
    act(() => renderer.unmount())
  })

  // Review, 2026-09-30 (fix round 3): '1. a<br><br>b\n2. c' drew the list
  // [a] and the paragraph "b 2. c". The parse and the Copy are pinned in
  // markdown-list-item-double-br.test.ts.
  it.each(SCHEMES)('draws a double break in a numbered item as a gap inside it, 2. still a marker (%s)', (scheme) => {
    const renderer = render('1. a<br><br>b\n2. c', scheme)
    const drawn = textOf(renderer.root)
    expect(drawn).toContain('a\n\nb')
    expect(drawn).not.toContain('2. c')
    expect(drawn).toMatch(/2\.\s*c$/)
    act(() => renderer.unmount())
  })

  it.each(SCHEMES)('draws the break in a list item and a heading (%s)', (scheme) => {
    const renderer = render('# Title<br>sub\n\n- Name: Ada<br>Role: Admin', scheme)
    expect(textOf(renderer.root)).toContain('Title\nsub')
    expect(textOf(renderer.root)).toContain('Name: Ada\nRole: Admin')
    act(() => renderer.unmount())
  })
})
