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

// Review, 2026-09-30: a PR review comment drew `Array<string>` as the chip
// "Array", `<div>` as an empty chip, and [`<T>`](url) as a link reading two
// backticks. The parse half is pinned in markdown-code-span-tags.test.ts;
// this is what the reader sees, in both schemes.

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

function styleOf(node: ReactTestInstance): Record<string, unknown> {
  const flat = (style: unknown): Record<string, unknown>[] =>
    Array.isArray(style) ? style.flatMap(flat) : style && typeof style === 'object' ? [style as Record<string, unknown>] : []
  return Object.assign({}, ...flat(node.props.style))
}

/** The Text whose own child is exactly `text`. */
function spanReading(renderer: ReactTestRenderer, text: string): ReactTestInstance {
  const span = renderer.root
    .findAllByType('Text' as never)
    .find((node) => node.children.length === 1 && node.children[0] === text)
  expect(span, `a span reading ${JSON.stringify(text)}`).toBeDefined()
  return span!
}

describe('a PR comment that quotes a tag inside backticks', () => {
  it.each(SCHEMES)('draws the tag in its code chip (%s)', (scheme, palette) => {
    const renderer = render('Use `Array<string>` or `<div>` here.', scheme)
    expect(textOf(renderer.root)).toBe('Use Array<string> or <div> here.')
    for (const code of ['Array<string>', '<div>']) {
      const chip = styleOf(spanReading(renderer, code))
      expect(chip.backgroundColor).toBe(palette.bgRaised)
      expect(chip.color).toBe(palette.text)
    }
    act(() => renderer.unmount())
  })

  it.each(SCHEMES)('draws a code span in a link label as code inside the link (%s)', (scheme, palette) => {
    const renderer = render('See [`<T>`](https://x.y) for it.', scheme)
    expect(textOf(renderer.root)).toBe('See <T> for it.')
    const chip = spanReading(renderer, '<T>')
    expect(styleOf(chip).backgroundColor).toBe(palette.bgRaised)
    let link = chip.parent!
    while (link.type !== ('Text' as never)) {
      link = link.parent!
    }
    expect(styleOf(link).textDecorationLine).toBe('underline')
    expect(styleOf(link).color).toBe(palette.text)
    expect(typeof link.props.onPress).toBe('function')
    act(() => renderer.unmount())
  })

  it('still drops a tag outside the code', () => {
    const renderer = render('<b>Bold</b> and `<i>`', 'light')
    expect(textOf(renderer.root)).toBe('Bold and <i>')
    act(() => renderer.unmount())
  })
})
