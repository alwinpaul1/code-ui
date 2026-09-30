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

// Review, 2026-09-30: '| a.ts | one<br>two |' drew "one" in the cell and
// "two" as a bogus row of its own. The parse and the Copy are pinned in
// markdown-table-cell-breaks.test.ts.

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

/** Each drawn table row's cells, as their text. */
function tableRows(renderer: ReactTestRenderer): string[][] {
  const rows = renderer.root.findAll(
    (node) => node.type === ('View' as never) && node.children.some((child) => typeof child !== 'string' && child.props.style && child.type === ('Text' as never)) && node.parent?.type === ('View' as never) && node.parent.parent?.type === ('ScrollView' as never)
  )
  return rows.map((row) => row.findAll((node) => node.type === ('Text' as never) && node.parent === row).map(textOf))
}

describe('a <br> in a table cell of a chat reply', () => {
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
