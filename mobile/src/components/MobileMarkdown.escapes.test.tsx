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

// Review, 2026-09-30: a backslash before punctuation makes it literal in
// CommonMark, and the phone never read one. `\*not bold\*` drew "not bold"
// in italics with both backslashes kept, and `off\!` drew its backslash. The
// Copy of the same replies is pinned in markdown-plain-text.test.ts.

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

/** Whether any Text in the document is drawn bold or italic. */
function anyStyled(renderer: ReactTestRenderer): { bold: boolean; italic: boolean } {
  let bold = false
  let italic = false
  for (const node of renderer.root.findAllByType('Text' as never)) {
    for (const style of stylesOf(node.props.style)) {
      bold ||= style.fontFamily === fontFamily.semibold
      italic ||= style.fontStyle === 'italic'
    }
  }
  return { bold, italic }
}

function pressables(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAll((node) => node.type === ('Text' as never) && typeof node.props.onPress === 'function')
    .map(textOf)
}

describe('a backslash before punctuation', () => {
  it.each(SCHEMES)('draws an escaped star as a star, with no italics and no backslash (%s)', (scheme) => {
    const renderer = render('\\*not bold\\*', scheme)
    expect(textOf(renderer.root)).toBe('*not bold*')
    expect(anyStyled(renderer)).toEqual({ bold: false, italic: false })
    act(() => renderer.unmount())
  })

  it.each(SCHEMES)('draws an escaped exclamation mark without its backslash (%s)', (scheme) => {
    const renderer = render('Price 50% off\\!', scheme)
    expect(textOf(renderer.root)).toBe('Price 50% off!')
    act(() => renderer.unmount())
  })

  it.each(SCHEMES)('keeps bold whole around an escaped star (%s)', (scheme) => {
    const renderer = render('**a \\* b**', scheme)
    expect(textOf(renderer.root)).toBe('a * b')
    expect(anyStyled(renderer)).toEqual({ bold: true, italic: false })
    act(() => renderer.unmount())
  })

  it('draws a Windows path with its backslashes, and an escaped backslash as one', () => {
    const renderer = render('C:\\Users\\x and a \\\\ b', 'light')
    expect(textOf(renderer.root)).toBe('C:\\Users\\x and a \\ b')
    act(() => renderer.unmount())
  })

  it('draws an escaped tag as the tag, not as bold', () => {
    const renderer = render('\\<b>x\\</b>', 'light')
    expect(textOf(renderer.root)).toBe('<b>x</b>')
    expect(anyStyled(renderer)).toEqual({ bold: false, italic: false })
    act(() => renderer.unmount())
  })

  it('reads an escaped bracket in a link\'s words, and an escaped opener as no link', () => {
    const renderer = render('[a \\] b](https://x.dev) and \\[c](https://y.dev)', 'light')
    expect(textOf(renderer.root)).toBe('a ] b and [c](https://y.dev)')
    expect(pressables(renderer)).toEqual(['a ] b', 'https://y.dev'])
    act(() => renderer.unmount())
  })

  it('keeps the backslashes in a code span', () => {
    const renderer = render('run `a\\*b` now', 'light')
    expect(textOf(renderer.root)).toContain('a\\*b')
    expect(textOf(renderer.root)).not.toContain('a*b')
    act(() => renderer.unmount())
  })

  it('reads a table cell\'s escapes once, after marked has read its pipe', () => {
    const renderer = render('| h |\n| --- |\n| x \\| y \\*z\\* |', 'light')
    expect(textOf(renderer.root)).toBe('hx | y *z*')
    act(() => renderer.unmount())
  })
})
