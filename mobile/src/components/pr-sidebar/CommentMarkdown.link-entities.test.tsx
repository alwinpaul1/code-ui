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

// Review, 2026-09-30: a bot-written '[a](https://x.dev/?a=1&amp;b=2)' in a PR
// comment opened with a literal '&amp;'. The parse is pinned in
// markdown-link-address-entities.test.ts.

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

function links(renderer: ReactTestRenderer): ReactTestInstance[] {
  return renderer.root.findAll((node) => node.type === ('Text' as never) && typeof node.props.onPress === 'function')
}

function tapAll(renderer: ReactTestRenderer): void {
  for (const link of links(renderer)) {
    act(() => link.props.onPress())
  }
}

beforeEach(() => {
  opened.length = 0
})

describe('HTML entities in a PR comment link\'s address', () => {
  it.each(SCHEMES)('opens a link and an image at their decoded address (%s)', (scheme) => {
    const renderer = render('[a](https://x.dev/?a=1&amp;b=2) ![shot](https://x.dev/i.png?w=1&#38;h=2)', scheme)
    expect(links(renderer)).toHaveLength(2)
    tapAll(renderer)
    expect(opened).toEqual(['https://x.dev/?a=1&b=2', 'https://x.dev/i.png?w=1&h=2'])
    act(() => renderer.unmount())
  })

  it.each(SCHEMES)('opens nothing for a scheme spelled with entities, as for one written out (%s)', (scheme) => {
    const renderer = render(
      '[x](javascript:alert(1)) [y](&#106;avascript:alert(1)) [z](java&#115;cript:alert(1)) [w](javascript&#58;alert(1))',
      scheme
    )
    expect(links(renderer)).toHaveLength(4)
    tapAll(renderer)
    expect(opened).toEqual([])
    act(() => renderer.unmount())
  })
})
