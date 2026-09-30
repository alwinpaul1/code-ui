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
import { markdownInlinePlainText, markdownPlainText } from './markdown-plain-text'
import { ThemeProvider } from '../theme/theme-context'
import { fontFamily } from '../theme/tokens'

// Review, 2026-09-30: a reply with maths or a glob in its prose, outside
// backticks, drew bold or italic between the operators and copied without
// the stars: `x ** 2 + y ** 2` drew " 2 + y " bold, and `2 * 3 * 4` copied as
// "2  3  4". CommonMark opens no emphasis on a run with a space after it and
// closes none on a run with a space before it. Both agents' text goes through
// the same renderer; each shape is pinned because they word maths
// differently.

/** How Claude Code writes it: prose, a bold lead-in, a dash list. */
const CLAUDE_REPLY = [
  'The distance check was wrong. It compared dx ** 2 + dy ** 2 against r instead of r ** 2, so every hit near the edge missed.',
  '',
  '- **Fix:** compare against r * r',
  '- Cost stays at n * m * 4 bytes for the grid',
  '- The glob is * and the fallback is * too'
].join('\n')

const CLAUDE_COPY = [
  'The distance check was wrong. It compared dx ** 2 + dy ** 2 against r instead of r ** 2, so every hit near the edge missed.',
  '',
  '• Fix: compare against r * r',
  '• Cost stays at n * m * 4 bytes for the grid',
  '• The glob is * and the fallback is * too'
].join('\n')

/** How Codex writes it: bold section titles over dash lists, paths in backticks. */
const CODEX_REPLY = [
  '**Summary**',
  '- Retry delay is now base * 2 ** attempt, capped at 30 * 1000 ms (`src/retry.ts:42`).',
  '- Area math: w * h / 2 for triangles, w * h for boxes.',
  '',
  '**Tests**',
  '- `npm test` passes; 3 * 4 * 5 = 60 is in the fixture.'
].join('\n')

const CODEX_COPY = [
  'Summary',
  '',
  '• Retry delay is now base * 2 ** attempt, capped at 30 * 1000 ms (src/retry.ts:42).',
  '• Area math: w * h / 2 for triangles, w * h for boxes.',
  '',
  'Tests',
  '',
  '• npm test passes; 3 * 4 * 5 = 60 is in the fixture.'
].join('\n')

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

/** Every run of words the reply draws bold, and every one it draws italic. */
function styledWords(renderer: ReactTestRenderer): { bold: string[]; italic: string[] } {
  const bold: string[] = []
  const italic: string[] = []
  for (const span of renderer.root.findAllByType('Text' as never)) {
    for (const child of span.children) {
      if (typeof child !== 'string' || !child.trim()) {
        continue
      }
      let isBold = false
      let isItalic = false
      for (let node: ReactTestInstance | null = span; node; node = node.parent) {
        if (node.type !== ('Text' as never)) {
          continue
        }
        for (const style of stylesOf(node.props.style)) {
          isBold ||= style.fontFamily === fontFamily.semibold
          isItalic ||= style.fontStyle === 'italic'
        }
      }
      if (isBold) {
        bold.push(child)
      }
      if (isItalic) {
        italic.push(child)
      }
    }
  }
  return { bold, italic }
}

describe('prose maths and globs in a reply', () => {
  it.each(SCHEMES)('draws a Claude Code reply with its operators and no emphasis between them (%s)', (scheme) => {
    const renderer = render(CLAUDE_REPLY, scheme)
    const drawn = textOf(renderer.root)
    expect(drawn).toContain('It compared dx ** 2 + dy ** 2 against r instead of r ** 2, so every hit')
    expect(drawn).toContain('compare against r * r')
    expect(drawn).toContain('Cost stays at n * m * 4 bytes for the grid')
    expect(drawn).toContain('The glob is * and the fallback is * too')
    expect(styledWords(renderer)).toEqual({ bold: ['Fix:'], italic: [] })
    act(() => renderer.unmount())
  })

  it.each(SCHEMES)('draws a Codex reply with its operators and only its titles bold (%s)', (scheme) => {
    const renderer = render(CODEX_REPLY, scheme)
    const drawn = textOf(renderer.root)
    expect(drawn).toContain('Retry delay is now base * 2 ** attempt, capped at 30 * 1000 ms (')
    expect(drawn).toContain('Area math: w * h / 2 for triangles, w * h for boxes.')
    expect(drawn).toContain(' passes; 3 * 4 * 5 = 60 is in the fixture.')
    expect(styledWords(renderer)).toEqual({ bold: ['Summary', 'Tests'], italic: [] })
    act(() => renderer.unmount())
  })

  it('copies both replies with every operator the screen drew', () => {
    expect(markdownPlainText(CLAUDE_REPLY)).toBe(CLAUDE_COPY)
    expect(markdownPlainText(CODEX_REPLY)).toBe(CODEX_COPY)
  })

  it('copies the reported sentences as they were written', () => {
    expect(markdownPlainText('area = x ** 2 + y ** 2, or 2 * 3 * 4')).toBe('area = x ** 2 + y ** 2, or 2 * 3 * 4')
    expect(markdownPlainText('a * b * c')).toBe('a * b * c')
    expect(markdownPlainText('glob: * and *')).toBe('glob: * and *')
    expect(markdownPlainText('x __ y __ z and x _ y _ z')).toBe('x __ y __ z and x _ y _ z')
  })

  it('reads a lone star, a lone pair and a spaced pair as text', () => {
    for (const text of ['* and *', '*', '**', '* *', '** **', '_ and _', '_', '__', '_ _', '__ __']) {
      expect(markdownInlinePlainText(text)).toBe(text)
    }
    expect(markdownInlinePlainText('')).toBe('')
  })

  it('still reads emphasis whose runs touch its words', () => {
    expect(markdownInlinePlainText('**bold**, *it*, *a*, __b__ and _c_')).toBe('bold, it, a, b and c')
    expect(markdownInlinePlainText('***x***, **a *b* c**, *a **b** c* and ***x** y*')).toBe(
      'x, a b c, a b c and x y'
    )
    expect(markdownInlinePlainText('~~gone~~ and `x ** 2`')).toBe('gone and x ** 2')
    expect(markdownInlinePlainText('**a b**, *a b* and __a b__')).toBe('a b, a b and a b')
  })

  it('leaves a bold or italic that starts or ends on a space open, its marks as text', () => {
    for (const text of ['**a **', '** a**', '*a *', '* a*', '__a __', '_a _']) {
      expect(markdownInlinePlainText(text)).toBe(text)
    }
    // The spaced pair opens nothing, so the bold after it pairs with its own.
    expect(markdownInlinePlainText('x ** 2 **y**')).toBe('x ** 2 y')
  })
})

describe('spaced operators that never pair', () => {
  it.each([
    ['a spaced power after every word', 'x ** 2 '.repeat(20_000)],
    ['a spaced star after every word', 'a * '.repeat(30_000)],
    ['spaced star pairs', '* '.repeat(50_000)],
    ['spaced bold pairs', '** '.repeat(50_000)],
    ['a bold opener before a long run of spaces', `**a${' '.repeat(100_000)}`],
    ['an italic opener before a long run of spaces', `*a${' '.repeat(100_000)}`],
    ['italics that each end on a space inside a bold', `**x ${'*a '.repeat(30_000)}`]
  ])('copies %s inside the deadline', (_name, text) => {
    const copied = runInNewContext('copy(text)', { copy: markdownInlinePlainText, text }, { timeout: 250 })
    expect(typeof copied).toBe('string')
  })
})
