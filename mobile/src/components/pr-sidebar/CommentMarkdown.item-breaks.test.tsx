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

// Review, 2026-09-30: '1. **File**<br>`x.ts`' in a PR comment drew the item's
// first line as a list, `x.ts` as a paragraph at the margin, and the rest as a
// second list counting from 2. The parse is pinned in
// markdown-item-breaks.test.ts.

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

/** The comment's top-level blocks, as their drawn text. */
function drawnBlocks(renderer: ReactTestRenderer): string[] {
  const [root] = renderer.root.findAll((node) => node.type === ('View' as never), { deep: true })
  return root!.children.map(textOf)
}

describe('a <br> in a PR comment\'s list item, quote or heading', () => {
  it.each(SCHEMES)('draws a numbered list as one list, the break inside its item (%s)', (scheme) => {
    const renderer = render('1. **File**<br>`x.ts`\n2. **Other**<br>`y.ts`', scheme)
    const items = renderer.root.findAll((node) => node.props.testID === 'comment-list-item' && node.type === ('View' as never))
    expect(items.map(textOf)).toEqual(['1.File\nx.ts', '2.Other\ny.ts'])
    expect(drawnBlocks(renderer)).toHaveLength(1)
    act(() => renderer.unmount())
  })

  it.each(SCHEMES)('draws a quote, and a heading, as one block with the break inside it (%s)', (scheme) => {
    const quote = render('> a<br>b', scheme)
    expect(drawnBlocks(quote)).toEqual(['a\nb'])
    act(() => quote.unmount())
    const heading = render('## T<br>sub', scheme)
    expect(drawnBlocks(heading)).toEqual(['T\nsub'])
    act(() => heading.unmount())
  })
})
