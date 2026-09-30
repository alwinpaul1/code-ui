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

// Review, 2026-09-30: a PR comment with maths or a glob in its prose drew
// bold or italic between the operators, as the chat did
// (MobileMarkdown.spaced-operators.test.tsx): `x ** 2 + y ** 2` drew " 2 + y "
// bold and `2 * 3 * 4` drew " 3 " italic with its stars gone. CommonMark opens
// no emphasis on a run with a space after it and closes none on a run with a
// space before it.

const SCHEMES = ['light', 'dark'] as const

const REVIEW = [
  'Nit: this is O(n * m) now; the old loop was n * n * 2.',
  '',
  'The bound should be x ** 2 + y ** 2 <= r ** 2, and the glob * and * both match. **Blocking** until then.'
].join('\n')

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

/** Every run of words the comment draws bold, and every one it draws italic. */
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
          isBold ||= style.fontWeight === '700'
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

describe('prose maths and globs in a PR comment', () => {
  it.each(SCHEMES)('draws the operators and no emphasis between them (%s)', (scheme) => {
    const renderer = render(REVIEW, scheme)
    const drawn = textOf(renderer.root)
    expect(drawn).toContain('Nit: this is O(n * m) now; the old loop was n * n * 2.')
    expect(drawn).toContain('The bound should be x ** 2 + y ** 2 <= r ** 2, and the glob * and * both match. Blocking')
    expect(styledWords(renderer)).toEqual({ bold: ['Blocking'], italic: [] })
    act(() => renderer.unmount())
  })

  it('reads the reported sentences as text', () => {
    for (const text of ['area = x ** 2 + y ** 2, or 2 * 3 * 4', 'a * b * c', 'glob: * and *', 'x __ y __ z and x _ y _ z']) {
      expect(parseInline(text)).toEqual([{ kind: 'text', text }])
    }
  })

  it('reads a lone star, a lone pair and a spaced pair as text', () => {
    for (const text of ['* and *', '*', '**', '* *', '** **', '_ and _', '_', '__', '_ _', '__ __']) {
      expect(parseInline(text)).toEqual([{ kind: 'text', text }])
    }
    expect(parseInline('')).toEqual([])
  })

  it('leaves a bold or italic that starts or ends on a space open', () => {
    for (const text of ['**a **', '** a**', '*a *', '* a*', '__a __', '_a _', 'Name: *** Date: ***']) {
      expect(parseInline(text)).toEqual([{ kind: 'text', text }])
    }
    expect(parseInline('x ** 2 **y**')).toEqual([
      { kind: 'text', text: 'x ** 2 ' },
      { kind: 'bold', text: 'y' }
    ])
  })

  it('still reads emphasis whose runs touch its words', () => {
    expect(parseInline('**a b**, *a*, *a b*, __b__ and _c_')).toEqual([
      { kind: 'bold', text: 'a b' },
      { kind: 'text', text: ', ' },
      { kind: 'italic', text: 'a' },
      { kind: 'text', text: ', ' },
      { kind: 'italic', text: 'a b' },
      { kind: 'text', text: ', ' },
      { kind: 'bold', text: 'b' },
      { kind: 'text', text: ' and ' },
      { kind: 'italic', text: 'c' }
    ])
    expect(parseInline('***x*** and **a *b* c**')).toEqual([
      { kind: 'bold', text: '*x*' },
      { kind: 'text', text: ' and ' },
      { kind: 'bold', text: 'a *b* c' }
    ])
  })
})

describe('a PR comment of spaced operators that never pair', () => {
  it.each([
    ['a spaced power after every word', 'x ** 2 '.repeat(20_000)],
    ['a spaced star after every word', 'a * '.repeat(30_000)],
    ['spaced bold pairs', '** '.repeat(50_000)],
    ['a bold opener before a long run of spaces', `**a${' '.repeat(100_000)}`],
    ['an italic opener before a long run of spaces', `*a${' '.repeat(100_000)}`],
    ['italics that each end on a space inside a bold', `**x ${'*a '.repeat(30_000)}`]
  ])('reads %s inside the deadline', (_name, text) => {
    const tokens = runInNewContext('parse(text)', { parse: parseInline, text }, { timeout: 250 })
    expect(Array.isArray(tokens)).toBe(true)
  })
})
