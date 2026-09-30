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

// Review, 2026-09-30: a PR comment drew '- parent\n  - child' as two
// bullets at the same margin, and a checklist's '- [x] done' as a bullet
// before the literal text "[x] done". The parse is pinned in
// markdown-nested-lists.test.ts; this is what the reader sees, in both
// schemes.

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

/** Each item's row: its marker, its words, and how far it is stepped in. */
function rows(renderer: ReactTestRenderer): { marker: string; words: string; indent: number }[] {
  return renderer.root
    .findAllByType('View' as never)
    .filter((node) => node.props.testID === 'comment-list-item')
    .map((row) => {
      const [marker, words] = row.findAllByType('Text' as never).filter((node) => node.parent === row)
      return { marker: textOf(marker!), words: textOf(words!), indent: Number(styleOf(row).marginLeft ?? 0) }
    })
}

describe('a nested list and a task list in a PR comment', () => {
  it.each(SCHEMES)('steps a nested item in under its parent with its own bullet (%s)', (scheme) => {
    const renderer = render('- parent\n  - child\n- sibling', scheme)
    const drawn = rows(renderer)
    expect(drawn.map(({ marker, words }) => [marker, words])).toEqual([
      ['•', 'parent'],
      ['◦', 'child'],
      ['•', 'sibling']
    ])
    expect(drawn[0]!.indent).toBe(0)
    expect(drawn[1]!.indent).toBeGreaterThan(0)
    expect(drawn[2]!.indent).toBe(0)
    act(() => renderer.unmount())
  })

  it.each(SCHEMES)('numbers a nested numbered list by itself (%s)', (scheme) => {
    const renderer = render('1. a\n   1. x\n   2. y\n2. b', scheme)
    expect(rows(renderer).map(({ marker, words }) => [marker, words])).toEqual([
      ['1.', 'a'],
      ['1.', 'x'],
      ['2.', 'y'],
      ['2.', 'b']
    ])
    act(() => renderer.unmount())
  })

  it.each(SCHEMES)('draws a task item as a box in the theme colour, never "[x]" (%s)', (scheme, colors) => {
    const renderer = render('- [x] done\n- [ ] todo', scheme)
    expect(textOf(renderer.root)).not.toContain('[x]')
    expect(textOf(renderer.root)).not.toContain('[ ]')
    expect(rows(renderer).map(({ marker, words }) => [marker, words])).toEqual([
      ['☑', 'done'],
      ['☐', 'todo']
    ])
    const boxes = renderer.root.findAll((node) => node.type === ('Text' as never) && node.props.accessibilityRole === 'checkbox')
    expect(boxes.map((box) => box.props.accessibilityState)).toEqual([{ checked: true }, { checked: false }])
    for (const box of boxes) {
      expect(styleOf(box).color).toBe(colors.textSecondary)
    }
    act(() => renderer.unmount())
  })

  it.each(SCHEMES)('steps a nested item after a blank line in under its parent (%s)', (scheme) => {
    // Review, 2026-09-30: it drew as a list of its own at the margin, and cut the numbers in three.
    const renderer = render('3. a\n\n   - x\n4. b', scheme)
    const drawn = rows(renderer)
    expect(drawn.map(({ marker, words }) => [marker, words])).toEqual([
      ['3.', 'a'],
      ['◦', 'x'],
      ['4.', 'b']
    ])
    expect(drawn[1]!.indent).toBeGreaterThan(0)
    expect(drawn[2]!.indent).toBe(0)
    act(() => renderer.unmount())
  })

  it.each(SCHEMES)('draws a flat list as it always did (%s)', (scheme) => {
    const renderer = render('3. c\n4. d', scheme)
    expect(rows(renderer)).toEqual([
      { marker: '3.', words: 'c', indent: 0 },
      { marker: '4.', words: 'd', indent: 0 }
    ])
    act(() => renderer.unmount())
  })
})
