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
import { darkColors, lightColors } from '../theme/tokens'

// Review, 2026-09-30 (two reviewers): a fence inside a quote reached the HTML
// pass, so the quote drew `**x** &` for `<b>x</b> &amp;` and a bare `a` for
// `<Text>a</Text>`. Then, the same day: the fence was still the quote's TEXT,
// so the inline pass drew its backticks as a code span across lines, a tilde
// fence as strikethrough, its language as a word and a stray newline at each
// end. A quoted fence is a code block now, drawn inside the quote's bar, and
// what is pinned here is that its code arrives exactly as written and that no
// fence mark reaches the quote's words. The Copy is pinned in
// markdown-plain-text.test.ts, the parse in mobile-markdown-quote-fence.test.ts.

const SCHEMES = ['light', 'dark'] as const
type Scheme = (typeof SCHEMES)[number]

function render(content: string, scheme: Scheme): ReactTestRenderer {
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

function flat(style: unknown): Record<string, unknown> {
  const list = Array.isArray(style) ? style.flat(4) : [style]
  return Object.assign({}, ...list.filter(Boolean))
}

function views(root: ReactTestInstance, test: (style: Record<string, unknown>) => boolean): ReactTestInstance[] {
  return root.findAll((node) => node.type === ('View' as never) && test(flat(node.props.style)))
}

/** The quote bars: the Views with a bar down their side, in document order. */
function bars(renderer: ReactTestRenderer): ReactTestInstance[] {
  return views(renderer.root, (style) => style.borderLeftWidth !== undefined)
}

/** The quote's words: each bar's own Text, not a code block's lines. */
function quoteWords(renderer: ReactTestRenderer): string[] {
  return bars(renderer).flatMap((bar) =>
    bar.children
      .filter((child): child is ReactTestInstance => typeof child !== 'string' && child.type === ('Text' as never))
      .map(textOf)
  )
}

/** The code blocks: the Views on the scheme's code fill. */
function codeBlocks(root: ReactTestInstance, scheme: Scheme): ReactTestInstance[] {
  const fill = (scheme === 'light' ? lightColors : darkColors).codeBg
  return views(root, (style) => style.backgroundColor === fill)
}

/** A code block's code as drawn: each numbered row's line, gutter left out. */
function codeOf(block: ReactTestInstance): string {
  const rows = views(block, (style) => style.flexDirection === 'row' && style.alignItems === 'flex-start')
  return rows.map((row) => textOf(row.findAllByType('Text' as never)[1]!)).join('\n')
}

/** The document's gap between blocks, which a bar that carries on a quote
 *  has to close for the bar to run unbroken. */
function blockGap(renderer: ReactTestRenderer): number {
  const root = renderer.root.findAll((node) => node.type === ('View' as never) && node.props.collapsable === false)[0]!
  return flat(root.props.style).gap as number
}

describe('a fenced code block inside a quote', () => {
  it.each(SCHEMES)('draws its tags and entities as written (%s)', (scheme) => {
    const renderer = render('Before:\n\n> ```\n> <b>x</b> &amp;\n> ```\n\nAfter <b>bold</b>.', scheme)
    const [bar] = bars(renderer)
    expect(bars(renderer)).toHaveLength(1)
    expect(codeBlocks(bar!, scheme).map(codeOf)).toEqual(['<b>x</b> &amp;'])
    // The prose after the quote still goes through the HTML pass.
    expect(textOf(renderer.root)).toContain('After bold.')
    act(() => renderer.unmount())
  })

  it.each(SCHEMES)('keeps a component tag in a language fence (%s)', (scheme) => {
    const renderer = render('> ```tsx\n> <Text>a</Text>\n> ```', scheme)
    expect(codeBlocks(renderer.root, scheme).map(codeOf)).toEqual(['<Text>a</Text>'])
    act(() => renderer.unmount())
  })

  it.each(SCHEMES)('draws a quoted fence as a code block inside the quote’s bar, with no fence marks (%s)', (scheme) => {
    const renderer = render('> ```\n> x = 1\n> ```', scheme)
    const quoteBars = bars(renderer)
    expect(quoteBars).toHaveLength(1)
    expect(flat(quoteBars[0]!.props.style).borderLeftColor).toBe(
      (scheme === 'light' ? lightColors : darkColors).borderStrong
    )
    expect(codeBlocks(quoteBars[0]!, scheme).map(codeOf)).toEqual(['x = 1'])
    // No quote words at all: the fence was all the quote held.
    expect(quoteWords(renderer)).toEqual([])
    expect(textOf(renderer.root)).not.toContain('`')
    act(() => renderer.unmount())
  })

  it.each(SCHEMES)('draws a quoted tilde fence as code, not as struck-through text (%s)', (scheme) => {
    const renderer = render('> ~~~\n> git commit -m "**wip**" *.ts\n> ~~~', scheme)
    expect(codeBlocks(renderer.root, scheme).map(codeOf)).toEqual(['git commit -m "**wip**" *.ts'])
    expect(quoteWords(renderer)).toEqual([])
    expect(textOf(renderer.root)).not.toContain('~')
    act(() => renderer.unmount())
  })

  it.each(SCHEMES)('keeps the words around a quoted fence in the quote, without its language, under one bar (%s)', (scheme) => {
    const renderer = render('> intro\n>\n> ```sh\n> ls *.ts\n> ```\n>\n> outro', scheme)
    expect(quoteWords(renderer)).toEqual(['intro', 'outro'])
    expect(codeBlocks(renderer.root, scheme).map(codeOf)).toEqual(['ls *.ts'])
    const [first, code, last] = bars(renderer)
    expect(bars(renderer)).toHaveLength(3)
    expect(codeBlocks(code!, scheme)).toHaveLength(1)
    // One quote, one bar: each block after the first closes the gap above it
    // and keeps the same distance inside, so the bar runs unbroken.
    const gap = blockGap(renderer)
    expect(gap).toBeGreaterThan(0)
    expect(flat(first!.props.style).marginTop).toBeUndefined()
    expect(flat(code!.props.style)).toMatchObject({ marginTop: -gap, paddingTop: gap })
    expect(flat(last!.props.style)).toMatchObject({ marginTop: -gap, paddingTop: gap })
    act(() => renderer.unmount())
  })

  it.each(SCHEMES)('keeps two quotes a blank line apart as two bars (%s)', (scheme) => {
    const renderer = render('> a\n\n> ```\n> x\n> ```', scheme)
    const quoteBars = bars(renderer)
    expect(quoteBars).toHaveLength(2)
    expect(flat(quoteBars[1]!.props.style).marginTop).toBeUndefined()
    act(() => renderer.unmount())
  })

  it.each(SCHEMES)('runs an unclosed quoted fence to the end of the quote as code (%s)', (scheme) => {
    const renderer = render('> ```\n> unclosed `x`', scheme)
    expect(codeBlocks(renderer.root, scheme).map(codeOf)).toEqual(['unclosed `x`'])
    expect(quoteWords(renderer)).toEqual([])
    act(() => renderer.unmount())
  })

  it.each(SCHEMES)('draws a quoted fence under a list item as code after the item (%s)', (scheme) => {
    const renderer = render('- item\n  > ```\n  > <b>x</b>\n  > ```', scheme)
    const [bar] = bars(renderer)
    expect(bars(renderer)).toHaveLength(1)
    expect(codeBlocks(bar!, scheme).map(codeOf)).toEqual(['<b>x</b>'])
    expect(textOf(renderer.root)).toContain('item')
    act(() => renderer.unmount())
  })

  it.each(SCHEMES)('draws a quoted mermaid fence as a diagram inside the bar (%s)', (scheme) => {
    const renderer = render('> ```mermaid\n> graph TD\n> ```', scheme)
    const [bar] = bars(renderer)
    const diagrams = bar!.findAll((node) => node.type === ('MermaidDiagram' as never))
    expect(diagrams.map((node) => node.props.source)).toEqual(['graph TD'])
    act(() => renderer.unmount())
  })

  describe('at the degenerate sizes', () => {
    it.each(SCHEMES)('draws an empty quoted fence as an empty code block, never as backticks (%s)', (scheme) => {
      for (const content of ['> ```\n> ```', '> ```']) {
        const renderer = render(content, scheme)
        expect(codeBlocks(renderer.root, scheme).map(codeOf)).toEqual([''])
        expect(textOf(renderer.root)).not.toContain('`')
        act(() => renderer.unmount())
      }
    })

    it.each(SCHEMES)('still draws a one-line prose quote as its words beside the bar (%s)', (scheme) => {
      const renderer = render('> quoted **text**', scheme)
      expect(bars(renderer)).toHaveLength(1)
      expect(quoteWords(renderer)).toEqual(['quoted text'])
      expect(codeBlocks(renderer.root, scheme)).toHaveLength(0)
      act(() => renderer.unmount())
    })
  })
})

// Decided 2026-10-01: a fence under a list item inside a quote is code, as
// GitHub and marked draw it; it drew as backticks around words in the quote.
describe('a fenced code block under a list item inside a quote', () => {
  it.each(SCHEMES)('draws as a code block inside the bar, after the item’s words (%s)', (scheme) => {
    const renderer = render('> - run this:\n>   ```sh\n>   pnpm test\n>   ```\n> - then this', scheme)
    expect(codeBlocks(renderer.root, scheme).map(codeOf)).toEqual(['pnpm test'])
    expect(quoteWords(renderer)).toEqual(['- run this:', '- then this'])
    const quoteBars = bars(renderer)
    expect(quoteBars).toHaveLength(3)
    expect(codeBlocks(quoteBars[1]!, scheme)).toHaveLength(1)
    expect(flat(quoteBars[0]!.props.style).borderLeftColor).toBe(
      (scheme === 'light' ? lightColors : darkColors).borderStrong
    )
    expect(textOf(renderer.root)).not.toContain('`')
    act(() => renderer.unmount())
  })
})
