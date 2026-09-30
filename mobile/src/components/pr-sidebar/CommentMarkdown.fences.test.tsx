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
import { darkColors, lightColors } from '../../theme/tokens'

// Review, 2026-09-30: a fence under a numbered item was joined into the
// item's text, so "1. Install:" drew with "sh npm i" as an inline chip, and
// the next item opened a fresh list numbered 1 again. The parse half is
// pinned in markdown-fences.test.ts; this is what the reader sees.

const SCHEMES = [
  ['light', lightColors],
  ['dark', darkColors]
] as const

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

function styleOf(node: ReactTestInstance): Record<string, unknown> {
  const flat = (style: unknown): Record<string, unknown>[] =>
    Array.isArray(style) ? style.flatMap(flat) : style && typeof style === 'object' ? [style as Record<string, unknown>] : []
  return Object.assign({}, ...flat(node.props.style))
}

const texts = (renderer: ReactTestRenderer): string[] =>
  renderer.root
    .findAllByType('Text' as never)
    .flatMap((node) => node.children.filter((child): child is string => typeof child === 'string'))

describe('a numbered PR comment with a fence under an item', () => {
  it.each(SCHEMES)('draws the fence as a code block and numbers on after it (%s)', (scheme, palette) => {
    const renderer = render(
      ['1. Install:', '', '   ```sh', '   npm i', '   ```', '', '2. Run:', '   ```', '   npm start', '   ```', '3. Done.'].join(
        '\n'
      ),
      scheme
    )
    expect(texts(renderer)).toEqual(['1.', 'Install:', 'npm i', '2.', 'Run:', 'npm start', '3.', 'Done.'])
    for (const code of ['npm i', 'npm start']) {
      const text = renderer.root.findAllByType('Text' as never).find((node) => node.children[0] === code)!
      expect(styleOf(text).color).toBe(palette.text)
      expect(styleOf(text.parent!).backgroundColor).toBe(palette.bgRaised)
    }
    act(() => renderer.unmount())
  })

  it('draws a list that opens at 3 from 3', () => {
    const renderer = render('3. third\n4. fourth', 'light')
    expect(texts(renderer)).toEqual(['3.', 'third', '4.', 'fourth'])
    act(() => renderer.unmount())
  })
})
