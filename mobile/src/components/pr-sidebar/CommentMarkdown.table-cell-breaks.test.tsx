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

// Review, 2026-09-30: '| a.ts | one<br>two |' in a PR comment drew "one" in
// the cell and "two" as a bogus row of its own. The parse is pinned in
// ../markdown-table-cell-breaks.test.ts.

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

/** Each drawn table row's cells, as their text: a row is a View of cell Views. */
function tableRows(renderer: ReactTestRenderer): string[][] {
  const table = renderer.root.findByType('ScrollView' as never)
  const body = table.findByType('View' as never)
  return body.children
    .filter((row): row is ReactTestInstance => typeof row !== 'string')
    .map((row) => row.children.filter((cell): cell is ReactTestInstance => typeof cell !== 'string').map(textOf))
}

describe('a <br> in a table cell of a PR comment', () => {
  it.each(SCHEMES)('draws two rows, the cell\'s two lines inside it (%s)', (scheme) => {
    const renderer = render('| File | Note |\n|---|---|\n| a.ts | one<br>two |\n| b.ts | ok |', scheme)
    expect(tableRows(renderer)).toEqual([
      ['File', 'Note'],
      ['a.ts', 'one\ntwo'],
      ['b.ts', 'ok']
    ])
    act(() => renderer.unmount())
  })
})
