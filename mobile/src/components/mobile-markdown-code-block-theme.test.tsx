import { describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'

vi.mock('react-native', () => ({
  Linking: { openURL: () => Promise.resolve() },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'dark',
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 }
}))
vi.mock('./pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))

import { MobileMarkdown } from './MobileMarkdown'
import { ThemeProvider } from '../theme/theme-context'
import { syntaxPaletteForScheme } from '../theme/syntax-palette'
import { fontFamily } from '../theme/tokens'

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

function spanStyle(renderer: ReactTestRenderer, text: string): Record<string, unknown> {
  const span = renderer.root
    .findAllByType('Text' as never)
    .find((node) => node.children.length === 1 && node.children[0] === text)
  expect(span, `a span reading ${JSON.stringify(text)}`).toBeDefined()
  const style = span!.props.style
  return Object.assign({}, ...(Array.isArray(style) ? style.flat(3) : [style]).filter(Boolean))
}

// Found while fixing the file viewer (2026-09-26): a chat code block sits on
// the themed code fill, but its spans took the dark-only syntax colours, so in
// light mode plain code was near-white on cream. And each span drew the UI
// face, as the file reader's did.
describe('a code block in a chat message', () => {
  it.each(['light', 'dark'] as const)('draws its code in the %s scheme’s code colours and the code face', (scheme) => {
    const palette = syntaxPaletteForScheme(scheme)
    const renderer = render(['```python', 'def cell(em):', '    return em', '```'].join('\n'), scheme)
    expect(spanStyle(renderer, 'def')).toMatchObject({ color: palette.keyword, fontFamily: fontFamily.mono })
    expect(spanStyle(renderer, 'return')).toMatchObject({ color: palette.control })
    expect(spanStyle(renderer, ' em')).toMatchObject({ color: palette.plain, fontFamily: fontFamily.mono })
    act(() => renderer.unmount())
  })
})
