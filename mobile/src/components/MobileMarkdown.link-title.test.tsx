import { beforeEach, describe, expect, it, vi } from 'vitest'
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
const opened = vi.hoisted(() => [] as string[])
vi.mock('../platform/external-link', () => ({ openExternalLink: (url: string) => opened.push(url) }))

import { MobileMarkdown } from './MobileMarkdown'
import { ThemeProvider } from '../theme/theme-context'

// Review, 2026-09-30: pressing '[the docs](https://x.dev/a "The docs")' in a
// chat reply opened 'https://x.dev/a "The docs"', title and all, while Copy
// pasted 'https://x.dev/a'. The routing is pinned in markdown-link-title.test.ts.

const SCHEMES = ['light', 'dark'] as const

function render(content: string, scheme: 'light' | 'dark', onOpenFile?: (path: string) => void): ReactTestRenderer {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileMarkdown content={content} onOpenFile={onOpenFile} />
      </ThemeProvider>
    )
  })
  return renderer
}

function textOf(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map(textOf).join('')
}

function press(renderer: ReactTestRenderer, words: string): void {
  const link = renderer.root.find(
    (node) => node.type === ('Text' as never) && typeof node.props.onPress === 'function' && textOf(node) === words
  )
  act(() => link.props.onPress())
}

beforeEach(() => {
  opened.length = 0
})

describe('a link with a title in a chat reply', () => {
  it.each(SCHEMES)('opens the address without the title (%s)', (scheme) => {
    const renderer = render('See [the docs](https://x.dev/a "The docs") now', scheme)
    expect(textOf(renderer.root)).toBe('See the docs now')
    press(renderer, 'the docs')
    expect(opened).toEqual(['https://x.dev/a'])
    act(() => renderer.unmount())
  })

  it.each(SCHEMES)('opens a file link\'s path without the title (%s)', (scheme) => {
    const files: string[] = []
    const renderer = render('Open [x](src/a.ts "t")', scheme, (path) => files.push(path))
    press(renderer, 'x')
    expect(files).toEqual(['src/a.ts'])
    expect(opened).toEqual([])
    act(() => renderer.unmount())
  })
})
