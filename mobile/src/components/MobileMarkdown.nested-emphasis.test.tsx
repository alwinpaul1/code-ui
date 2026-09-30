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
import { fontFamily } from '../theme/tokens'

// Review, 2026-09-30: `***really important***` and `**bold with *em*
// inside**` drew a literal star at each end of the phrase, and part of the
// text sat in the wrong span. Claude writes both often. The Copy of the same
// reply is pinned in markdown-plain-text.test.ts.

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

function stylesOf(style: unknown): Record<string, unknown>[] {
  if (Array.isArray(style)) {
    return style.flatMap(stylesOf)
  }
  return style && typeof style === 'object' ? [style as Record<string, unknown>] : []
}

/** Whether the words `text` draw bold and italic: every Text from their own
 *  span out to the document's paragraph. */
function drawnAs(renderer: ReactTestRenderer, text: string): { bold: boolean; italic: boolean } {
  const span = renderer.root
    .findAllByType('Text' as never)
    .find((node) => node.children.some((child) => child === text))
  expect(span, `a span reading ${JSON.stringify(text)}`).toBeDefined()
  let bold = false
  let italic = false
  for (let node: ReactTestInstance | null = span!; node; node = node.parent) {
    if (node.type !== ('Text' as never)) {
      continue
    }
    for (const style of stylesOf(node.props.style)) {
      bold ||= style.fontFamily === fontFamily.semibold
      italic ||= style.fontStyle === 'italic'
    }
  }
  return { bold, italic }
}

describe('emphasis nested inside emphasis', () => {
  it.each(SCHEMES)('draws ***x*** bold and italic, and **a *b* c** bold around italic, with no stars (%s)', (scheme) => {
    const renderer = render('This is ***really important*** and **bold with *em* inside**', scheme)
    expect(textOf(renderer.root)).toBe('This is really important and bold with em inside')
    expect(drawnAs(renderer, 'This is ')).toEqual({ bold: false, italic: false })
    expect(drawnAs(renderer, 'really important')).toEqual({ bold: true, italic: true })
    expect(drawnAs(renderer, ' and ')).toEqual({ bold: false, italic: false })
    expect(drawnAs(renderer, 'bold with ')).toEqual({ bold: true, italic: false })
    expect(drawnAs(renderer, 'em')).toEqual({ bold: true, italic: true })
    expect(drawnAs(renderer, ' inside')).toEqual({ bold: true, italic: false })
    act(() => renderer.unmount())
  })

  it.each(SCHEMES)('draws the underscore forms the same way, with no underscores (%s)', (scheme) => {
    const renderer = render('___x___ and __a _b_ c__', scheme)
    expect(textOf(renderer.root)).toBe('x and a b c')
    expect(drawnAs(renderer, 'x')).toEqual({ bold: true, italic: true })
    expect(drawnAs(renderer, 'b')).toEqual({ bold: true, italic: true })
    expect(drawnAs(renderer, 'a ')).toEqual({ bold: true, italic: false })
    act(() => renderer.unmount())
  })

  // Review, 2026-09-30, the mirror image: an italic could hold no star, so
  // `*a **b** c*` drew b not bold, and `***x** y*` drew its stars.
  it.each(SCHEMES)('draws *a **b** c* all italic with b bold, and ***x** y* with no stars (%s)', (scheme) => {
    const renderer = render('*a **b** c* and ***x** y*', scheme)
    expect(textOf(renderer.root)).toBe('a b c and x y')
    expect(drawnAs(renderer, 'a ')).toEqual({ bold: false, italic: true })
    expect(drawnAs(renderer, 'b')).toEqual({ bold: true, italic: true })
    expect(drawnAs(renderer, ' c')).toEqual({ bold: false, italic: true })
    expect(drawnAs(renderer, ' and ')).toEqual({ bold: false, italic: false })
    expect(drawnAs(renderer, 'x')).toEqual({ bold: true, italic: true })
    expect(drawnAs(renderer, ' y')).toEqual({ bold: false, italic: true })
    act(() => renderer.unmount())
  })

  it.each(SCHEMES)('draws the underscore italic holding bold the same way (%s)', (scheme) => {
    const renderer = render('_a __b__ c_ and ___x__ y_', scheme)
    expect(textOf(renderer.root)).toBe('a b c and x y')
    expect(drawnAs(renderer, 'b')).toEqual({ bold: true, italic: true })
    expect(drawnAs(renderer, ' c')).toEqual({ bold: false, italic: true })
    expect(drawnAs(renderer, 'x')).toEqual({ bold: true, italic: true })
    act(() => renderer.unmount())
  })

  it('draws an italic holding two bold spans', () => {
    const renderer = render('*x **y** z **w** v*', 'light')
    expect(textOf(renderer.root)).toBe('x y z w v')
    expect(drawnAs(renderer, 'y')).toEqual({ bold: true, italic: true })
    expect(drawnAs(renderer, ' z ')).toEqual({ bold: false, italic: true })
    expect(drawnAs(renderer, 'w')).toEqual({ bold: true, italic: true })
    act(() => renderer.unmount())
  })

  it('still draws plain bold and plain italic as one style each', () => {
    const renderer = render('**bold** and *italic*', 'light')
    expect(textOf(renderer.root)).toBe('bold and italic')
    expect(drawnAs(renderer, 'bold')).toEqual({ bold: true, italic: false })
    expect(drawnAs(renderer, 'italic')).toEqual({ bold: false, italic: true })
    act(() => renderer.unmount())
  })
})
