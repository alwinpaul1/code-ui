import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileMarkdown } from './MobileMarkdown'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'

vi.mock('react-native', () => ({
  Linking: { openURL: vi.fn() },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, flatten: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'dark',
  Platform: { OS: 'android', select: (options: Record<string, unknown>) => options.android ?? options.default }
}))
vi.mock('./pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))
vi.mock('./MobileMarkdownImage', () => ({ MobileMarkdownImage: 'MobileMarkdownImage' }))

// 2026-09-29: a link whose words are code, "[`app.ts:12`](mobile/src/app.ts#L12)",
// the way Claude names a file it changed, drew its backticks on the screen.
// The renderer put a link's label in its Text as written; only prose outside
// a link had its marks read. The label's code, bold, italic and strike now
// draw as style, and an image's alt text drops its marks.

describe('the words of a link', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(content: string): ReactTestRenderer {
    act(() => {
      renderer = create(createElement(MobileMarkdown, { content, onOpenFile: () => undefined }))
    })
    return renderer!
  }

  const flat = (node: ReactTestInstance | string): string =>
    typeof node === 'string' ? node : node.children.map(flat).join('')

  /** The link Texts: the ones a tap opens. */
  const links = (tree: ReactTestRenderer): ReactTestInstance[] =>
    tree.root.findAll((node) => node.type === ('Text' as never) && typeof node.props.onPress === 'function')

  const styleOf = (node: ReactTestInstance): object[] => [node.props.style].flat(Infinity).filter(Boolean)

  it('draws a link to a file named in code as the code, with no backticks', () => {
    const tree = render('open [`app.ts:12`](mobile/src/app.ts#L12) now')
    const [link] = links(tree)
    expect(flat(link!)).toBe('app.ts:12')
    const code = link!.findAll((node) => node !== link && node.type === ('Text' as never))
    expect(code.map(flat)).toEqual(['app.ts:12'])
    expect(styleOf(code[0]!).some((style) => 'fontSize' in style && 'backgroundColor' in style)).toBe(true)
  })

  it('draws a label\'s bold, italic and strike as style, not as stars and tildes', () => {
    const tree = render('see [**Bold** *docs* ~~old~~](https://x.dev) here')
    const [link] = links(tree)
    expect(flat(link!)).toBe('Bold docs old')
  })

  it('keeps a struck label underlined as a link', () => {
    const [link] = links(render('[~~old~~ docs](https://x.dev)'))
    const struck = link!.find((node) => node !== link && node.type === ('Text' as never))
    const style = Object.assign({}, ...styleOf(struck)) as { textDecorationLine?: string }
    expect(flat(struck)).toBe('old')
    expect(style.textDecorationLine).toBe('underline line-through')
  })

  it('keeps a plain label as it is, and a stray backtick in one as written', () => {
    const tree = render('[docs](https://x.dev) and [a`b](https://y.dev)')
    expect(links(tree).map(flat)).toEqual(['docs', 'a`b'])
    expect(links(tree)[0]!.children).toEqual(['docs'])
  })

  it('draws a one-character code label', () => {
    expect(links(render('[`x`](https://x.dev)')).map(flat)).toEqual(['x'])
  })

  it('draws an image\'s alt text without its marks, inline and as a figure', () => {
    const inline = render('see ![**b** alt](https://x.dev/a.png) here')
    expect(links(inline).map(flat)).toEqual(['b alt'])
    const figure = render('![**fig** `one`](fig/plot.svg)')
    expect(figure.root.findByType('MobileMarkdownImage' as never).props.alt).toBe('fig one')
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('draws the code in a link in the %s theme\'s link and code colours', (scheme, palette) => {
    act(() => {
      renderer = create(
        createElement(ThemeProvider, { initialPreference: scheme }, createElement(MobileMarkdown, { content: 'see [`app.ts`](https://x.dev)' }))
      )
    })
    const [link] = links(renderer!)
    const code = link!.find((node) => node !== link && node.type === ('Text' as never))
    const style = Object.assign({}, ...styleOf(code)) as { color?: string; backgroundColor?: string }
    expect(style.color).toBe(palette.accentText)
    expect(style.backgroundColor).toBe(palette.codeSpanBg)
  })
})
