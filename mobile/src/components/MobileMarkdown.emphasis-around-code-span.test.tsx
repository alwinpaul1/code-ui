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
import { MobileMarkdownCodeChip } from './MobileMarkdownCodeChip'
import { ThemeProvider } from '../theme/theme-context'
import { fontFamily } from '../theme/tokens'

// Review, 2026-09-30: `**Edit `*.ts` files**` drew `**Edit *.ts files**`,
// no bold and both star pairs literal, because the star inside the code span
// ended the bold. The Copy of the same replies is pinned in
// markdown-emphasis-around-code-span.test.ts.

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

/** Whether a node is drawn bold or italic: any Text from it out to the document. */
function styledAround(node: ReactTestInstance): { bold: boolean; italic: boolean } {
  let bold = false
  let italic = false
  for (let at: ReactTestInstance | null = node; at; at = at.parent) {
    if (at.type !== ('Text' as never)) {
      continue
    }
    for (const style of stylesOf(at.props.style)) {
      bold ||= style.fontFamily === fontFamily.semibold
      italic ||= style.fontStyle === 'italic'
    }
  }
  return { bold, italic }
}

function spanReading(renderer: ReactTestRenderer, text: string): ReactTestInstance {
  const span = renderer.root
    .findAllByType('Text' as never)
    .find((node) => node.children.some((child) => child === text))
  expect(span, `a span reading ${JSON.stringify(text)}`).toBeDefined()
  return span!
}

describe('emphasis around a code span that holds a star', () => {
  it.each(SCHEMES)('draws the phrase bold with the glob as a pill inside it, and no stars (%s)', (scheme) => {
    const renderer = render('**Edit `*.ts` files**', scheme)
    expect(textOf(renderer.root)).toBe('Edit *.ts files')
    expect(styledAround(spanReading(renderer, 'Edit '))).toEqual({ bold: true, italic: false })
    expect(styledAround(spanReading(renderer, ' files'))).toEqual({ bold: true, italic: false })
    const chips = renderer.root.findAllByType(MobileMarkdownCodeChip)
    expect(chips.map((chip) => chip.props.span)).toEqual(['*.ts'])
    expect(styledAround(chips[0]!).bold).toBe(true)
    act(() => renderer.unmount())
  })

  it.each(SCHEMES)('draws a list item that bolds a glob with the glob whole (%s)', (scheme) => {
    const renderer = render('- **`**/*.md`**: docs', scheme)
    expect(textOf(renderer.root)).not.toContain('****')
    const chips = renderer.root.findAllByType(MobileMarkdownCodeChip)
    expect(chips.map((chip) => chip.props.span)).toEqual(['**/*.md'])
    expect(styledAround(chips[0]!).bold).toBe(true)
    expect(textOf(renderer.root)).toContain('**/*.md: docs')
    act(() => renderer.unmount())
  })

  it.each(SCHEMES)('draws italic around a span with a star in it (%s)', (scheme) => {
    const renderer = render('*use `x*y` now*', scheme)
    expect(textOf(renderer.root)).toBe('use x*y now')
    expect(styledAround(spanReading(renderer, 'use '))).toEqual({ bold: false, italic: true })
    const chips = renderer.root.findAllByType(MobileMarkdownCodeChip)
    expect(chips.map((chip) => chip.props.span)).toEqual(['x*y'])
    act(() => renderer.unmount())
  })
})
