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
vi.mock('lucide-react-native', () => ({ ChevronDown: 'ChevronDown', ChevronRight: 'ChevronRight' }))
vi.mock('./MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))
const opened = vi.hoisted(() => [] as string[])
vi.mock('../../platform/external-link', () => ({ openExternalLink: (url: string) => opened.push(url) }))

import { CommentMarkdown } from './CommentMarkdown'
import { ThemeProvider } from '../../theme/theme-context'
import { darkColors, lightColors } from '../../theme/tokens'

// Review, 2026-09-30: a PR comment's screenshot drew "!shot", and a README
// badge drew "![CI" linked to the badge image, then "](https://ci.dev)". The
// parse is pinned in markdown-comment-images.test.ts.

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

function textOf(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map(textOf).join('')
}

function links(renderer: ReactTestRenderer): ReactTestInstance[] {
  return renderer.root.findAll((node) => node.type === ('Text' as never) && typeof node.props.onPress === 'function')
}

beforeEach(() => {
  opened.length = 0
})

describe('an image in a PR comment', () => {
  it.each(SCHEMES)('draws a screenshot as a link reading its alt text, with no "!" (%s)', (scheme) => {
    const renderer = render('Before ![shot](https://x.dev/i.png) after', scheme)
    expect(textOf(renderer.root)).toBe('Before shot after')
    const [link] = links(renderer)
    expect(textOf(link!)).toBe('shot')
    act(() => link!.props.onPress())
    expect(opened).toEqual(['https://x.dev/i.png'])
    act(() => renderer.unmount())
  })

  it.each(SCHEMES)('draws a badge as one link to its target, reading its alt text (%s)', (scheme) => {
    const renderer = render('[![CI](https://img.shields.io/b.svg)](https://ci.dev)', scheme)
    expect(textOf(renderer.root)).toBe('CI')
    const drawn = links(renderer)
    expect(drawn.map(textOf)).toEqual(['CI'])
    act(() => drawn[0]!.props.onPress())
    expect(opened).toEqual(['https://ci.dev'])
    act(() => renderer.unmount())
  })

  it.each(SCHEMES)('draws an image with no alt text as a link reading "image" (%s)', (scheme) => {
    const renderer = render('![](https://x.dev/i.png)', scheme)
    expect(links(renderer).map(textOf)).toEqual(['image'])
    act(() => renderer.unmount())
  })
})
