import { runInNewContext } from 'node:vm'
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
import { parseInline } from './markdown-blocks'
import { ThemeProvider } from '../../theme/theme-context'
import { darkColors, lightColors } from '../../theme/tokens'

// Review, 2026-09-30: a PR comment drew `***x***` as a star, bold x, a star,
// and `**a *b* c**` as a star, italic "a ", plain "b", italic " c", a star.
// The bold rule could not hold a star, and a bold token drew its inside as
// plain text, so an italic inside it could not draw even once matched. The
// chat renderer had both fixed in 35e8f142; this is the PR comment reader.

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

function stylesOf(style: unknown): Record<string, unknown>[] {
  if (Array.isArray(style)) {
    return style.flatMap(stylesOf)
  }
  return style && typeof style === 'object' ? [style as Record<string, unknown>] : []
}

/** How the words `text` draw: every Text from their own span out to the
 *  paragraph, merged, the innermost last. */
function drawnAs(renderer: ReactTestRenderer, text: string) {
  const span = renderer.root
    .findAllByType('Text' as never)
    .find((node) => node.children.some((child) => child === text))
  expect(span, `a span reading ${JSON.stringify(text)}`).toBeDefined()
  let bold = false
  let italic = false
  let color: unknown
  for (let node: ReactTestInstance | null = span!; node; node = node.parent) {
    if (node.type !== ('Text' as never)) {
      continue
    }
    for (const style of stylesOf(node.props.style)) {
      bold ||= style.fontWeight === '700'
      italic ||= style.fontStyle === 'italic'
      color ??= style.color
    }
  }
  return { bold, italic, color }
}

describe('a PR comment with emphasis nested inside emphasis', () => {
  it.each(SCHEMES)('draws ***x*** and **a *b* c** with no stars (%s)', (scheme, palette) => {
    const renderer = render('This is ***really important*** and **bold with *em* inside**', scheme)
    expect(textOf(renderer.root)).toBe('This is really important and bold with em inside')
    expect(drawnAs(renderer, 'This is ')).toEqual({ bold: false, italic: false, color: palette.text })
    expect(drawnAs(renderer, 'really important')).toEqual({ bold: true, italic: true, color: palette.text })
    expect(drawnAs(renderer, 'bold with ')).toEqual({ bold: true, italic: false, color: palette.text })
    expect(drawnAs(renderer, 'em')).toEqual({ bold: true, italic: true, color: palette.text })
    expect(drawnAs(renderer, ' inside')).toEqual({ bold: true, italic: false, color: palette.text })
    act(() => renderer.unmount())
  })

  it.each(SCHEMES)('draws the underscore forms the same way (%s)', (scheme) => {
    const renderer = render('___x___ and __a _b_ c__', scheme)
    expect(textOf(renderer.root)).toBe('x and a b c')
    expect(drawnAs(renderer, 'x')).toMatchObject({ bold: true, italic: true })
    expect(drawnAs(renderer, 'a ')).toMatchObject({ bold: true, italic: false })
    expect(drawnAs(renderer, 'b')).toMatchObject({ bold: true, italic: true })
    act(() => renderer.unmount())
  })

  it('still draws plain bold and plain italic as one style each', () => {
    const renderer = render('**bold** and *italic*', 'light')
    expect(textOf(renderer.root)).toBe('bold and italic')
    expect(drawnAs(renderer, 'bold')).toMatchObject({ bold: true, italic: false })
    expect(drawnAs(renderer, 'italic')).toMatchObject({ bold: false, italic: true })
    act(() => renderer.unmount())
  })

  it('leaves fill-in blanks, an unclosed bold and a bare star run as they were', () => {
    const renderer = render('___ Date: ___\n\n**a\n\n***\n\n2 * 3 * 4', 'light')
    expect(textOf(renderer.root)).toBe('___ Date: ___**a2  3  4')
    act(() => renderer.unmount())
  })
})

// The chat's own cases for its copy of this rule (markdown-plain-text.test.ts):
// a bold that never closes must not cost more than linear time.
describe('a PR comment whose emphasis never closes', () => {
  it.each([
    ['a bold over many italics', `**${'a *b* '.repeat(15_000)}`],
    ['a bold over many underscore italics', `__${'a _b_ '.repeat(15_000)}`],
    ['a bold opener on every line', '**a *b\n'.repeat(15_000)],
    ['a star after every word', `**${'x*y '.repeat(25_000)}`],
    ['italics joined end to end', `**${'*a*'.repeat(30_000)}`],
    ['a star run', '*'.repeat(100_000)]
  ])('reads %s inside the deadline', (_name, text) => {
    const tokens = runInNewContext('parse(text)', { parse: parseInline, text }, { timeout: 250 })
    expect(Array.isArray(tokens)).toBe(true)
  })
})
