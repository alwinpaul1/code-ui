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
vi.mock('./pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))

import { MobileMarkdown } from './MobileMarkdown'
import { renderLinkLabel } from './mobile-markdown-link-label'
import type { MarkdownStyles } from './mobile-markdown-styles'
import { ThemeProvider } from '../theme/theme-context'
import { fontFamily } from '../theme/tokens'

// Review, 2026-09-30: every underscore of `a__b__` sits inside a word, so
// each opener is refused, and the scan went on one character later, from the
// next underscore of the same run, where an italic holding bold spans ran to
// the end of the text before it was refused in turn: quadratic in the text's
// length, 6.7 s to copy 20,000 of them. The scan now goes on past the run
// (afterRefusedUnderscoreOpener). The Copy is timed in
// markdown-plain-text.test.ts; the screen draws a reply through marked first,
// which is slow on the same text by itself, so its loop is held to the same
// drawing here and the link label, which runs no marked, is timed.

function textOf(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map(textOf).join('')
}

function render(content: string): ReactTestRenderer {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference="light">
        <MobileMarkdown content={content} />
      </ThemeProvider>
    )
  })
  return renderer
}

function boldWords(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAllByType('Text' as never)
    .filter((node) => [node.props.style].flat(3).some((style) => style?.fontFamily === fontFamily.semibold))
    .map((node) => textOf(node))
}

describe('a reply of dunder names', () => {
  it('draws them as written, underscores and all', () => {
    const renderer = render('Edit a__b__ and src/__init__.py, then x__y__z and a___b___c.')
    expect(textOf(renderer.root)).toBe('Edit a__b__ and src/__init__.py, then x__y__z and a___b___c.')
    expect(boldWords(renderer)).toEqual([])
    act(() => renderer.unmount())
  })

  it('still draws a real span right after a run inside a word', () => {
    const renderer = render('x__y __bold__ and a___ **b** and snake__ _c_')
    expect(textOf(renderer.root)).toBe('x__y bold and a___ b and snake__ c')
    expect(boldWords(renderer)).toEqual(['bold', 'b'])
    act(() => renderer.unmount())
  })

  it.each([
    ['dunder names end to end', 'a__b__'.repeat(20_000)],
    ['dunder names end to end after an italic opener', `_x ${'a__b__'.repeat(20_000)}`]
  ])('draws %s in a link label inside the deadline', (_name, label) => {
    // No span is drawn, so no style is read.
    const styles = {} as MarkdownStyles
    const parts = runInNewContext('render(styles, label)', { render: renderLinkLabel, styles, label }, { timeout: 250 })
    expect(parts.join('')).toBe(label)
  })
})
