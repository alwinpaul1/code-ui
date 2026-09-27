import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
  Image: 'Image',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
  useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1, scale: 3 })
}))
vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  Copy: 'Copy',
  MessageSquare: 'MessageSquare',
  Send: 'Send',
  WrapText: 'WrapText',
  X: 'X'
}))
// The code viewer's Copy button writes through this; expo-clipboard cannot load here.
vi.mock('../platform/clipboard', () => ({ useClipboardWriter: () => ({ writeText: vi.fn() }) }))
vi.mock('../components/MobileHtmlPreview', () => ({ MobileHtmlPreview: 'MobileHtmlPreview' }))
vi.mock('../files/MobileFilePdfPreview', () => ({ MobileFilePdfPreview: 'MobileFilePdfPreview' }))
vi.mock('../files/MobileFileMarkdownPreview', () => ({
  MobileFileMarkdownPreview: 'MobileFileMarkdownPreview'
}))
vi.mock('../session/MobileSessionDiffLineRow', () => ({ DiffLineRow: 'DiffLineRow' }))
vi.mock('../session/mobile-session-styles', () => ({ styles: {} }))
vi.mock('../ui/Txt', () => ({ Txt: 'Txt' }))
vi.mock('../files/mobile-file-preview-request', () => ({
  formatPreviewByteLength: (n: number) => `${n} B`
}))

let scheme: 'light' | 'dark' = 'dark'
vi.mock('../theme/theme-context', async () => {
  const tokens = await vi.importActual<typeof import('../theme/tokens')>('../theme/tokens')
  const palettes = await vi.importActual<typeof import('../theme/syntax-palette')>('../theme/syntax-palette')
  const useTheme = () => ({
    colors: tokens.colorsForScheme(scheme),
    syntax: palettes.syntaxPaletteForScheme(scheme),
    fonts: tokens.fontFamily,
    space: tokens.space,
    radius: tokens.radius,
    type: tokens.type,
    isDark: scheme === 'dark'
  })
  return {
    useTheme,
    // The file preview's styles are a factory of the live theme (mobile-file-preview-styles.ts).
    useThemedStyles: <T,>(factory: (theme: ReturnType<typeof useTheme>) => T) => factory(useTheme())
  }
})

import { FileReader } from '../session/MobileSessionFileReader'
import { MobileFilePreviewSourceText } from '../files/MobileFilePreviewSourceText'
import { syntaxPaletteForScheme } from '../theme/syntax-palette'
import { CODE_VIEW_MAX_LINE_SPANS, capLineSpans } from './mobile-code-document'

// A minified bundle: one line, ~100 KB, the shape `dist/*.min.js` has.
const MINIFIED = Array.from(
  { length: 1250 },
  (_, i) => `function a${i}(b,c){return b[c]+${i}*2||"s${i}"}var x${i}=[1,2,3],y${i}={k:${i}};`
).join('')

let renderers: ReactTestRenderer[] = []
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  act(() => renderers.forEach((r) => r.unmount()))
  renderers = []
  vi.useRealTimers()
})

/** Draws the list's first row the way the FlatList would, once coloured. */
function firstRow(root: ReactTestRenderer): ReactTestRenderer {
  const list = root.root.findByType('FlatList' as never) as ReactTestInstance
  const element = list.props.renderItem({ item: list.props.data[0], index: 0 }) as ReactElement
  let row: ReactTestRenderer | null = null
  act(() => {
    row = create(element)
  })
  renderers.push(row!)
  return row!
}

function openInFileTab(content: string, relativePath: string): ReactTestRenderer {
  let r: ReactTestRenderer | null = null
  act(() => {
    r = create(
      createElement(FileReader, {
        doc: { status: 'ready', kind: 'file', content, truncated: false, byteLength: content.length },
        title: relativePath,
        relativePath
      } as never)
    )
  })
  renderers.push(r!)
  act(() => {
    vi.runAllTimers()
  })
  return r!
}

function openInExplorer(content: string, relativePath: string): ReactTestRenderer {
  let r: ReactTestRenderer | null = null
  act(() => {
    r = create(createElement(MobileFilePreviewSourceText, { relativePath, content }))
  })
  renderers.push(r!)
  act(() => {
    vi.runAllTimers()
  })
  return r!
}

function textNodes(row: ReactTestRenderer): ReactTestInstance[] {
  return row.root.findAllByType('Text' as never)
}

describe.each(['dark', 'light'] as const)('opening a minified bundle (%s)', (current) => {
  beforeEach(() => {
    scheme = current
  })

  it('does not mount tens of thousands of coloured spans into the one row a minified file is', () => {
    expect(MINIFIED.length).toBeGreaterThan(90_000)
    expect(MINIFIED.length).toBeLessThan(128_000)
    // main capped a file's colouring at 3,000 spans and drew it plain past
    // that. The windowed list does not help a one-line file: all of its spans
    // are in the one row that is on screen. The row is the number, the line's
    // Text, and its spans.
    const row = firstRow(openInFileTab(MINIFIED, 'dist/app.min.js'))
    expect(textNodes(row).length).toBeLessThanOrEqual(CODE_VIEW_MAX_LINE_SPANS + 2)
  })

  it('does not mount them in the explorer preview either', () => {
    const row = firstRow(openInExplorer(MINIFIED, 'dist/app.min.js'))
    expect(textNodes(row).length).toBeLessThanOrEqual(CODE_VIEW_MAX_LINE_SPANS + 2)
  })

  it('still colours the start of the line, and draws the rest in the plain code colour, every character kept', () => {
    const row = firstRow(openInFileTab(MINIFIED, 'dist/app.min.js'))
    const palette = syntaxPaletteForScheme(current)
    // The line's own Text (the gutter's is not clipped), and the spans in it.
    const code = row.root.find((node) => node.type === ('Text' as never) && node.props.ellipsizeMode === 'clip')
    const spans = code.findAll((node) => node.type === ('Text' as never) && node !== code)
    const colourOf = (span: ReactTestInstance) => (span.props.style as { color: string }).color
    expect(spans.slice(0, 20).some((span) => colourOf(span) !== palette.plain)).toBe(true)
    expect(colourOf(spans.at(-1)!)).toBe(palette.plain)
    const drawn = spans.map((span) => span.children.join('')).join('')
    expect(drawn).toBe(MINIFIED)
  })
})

describe('the per-line span budget, at its edges', () => {
  const span = (text: string, kind: 'keyword' | 'plain' | 'string' = 'keyword') => ({ text, kind })

  it('leaves an empty line, a one-span line and a line exactly at the budget as they are', () => {
    expect(capLineSpans([], 3)).toEqual([])
    const one = [span('a')]
    expect(capLineSpans(one, 3)).toBe(one)
    const full = [span('a'), span('b', 'string'), span('c')]
    expect(capLineSpans(full, 3)).toBe(full)
  })

  it('folds everything past the budget into one plain span, one over the budget included', () => {
    const over = [span('a'), span('b', 'string'), span('c'), span('d', 'string')]
    expect(capLineSpans(over, 3)).toEqual([span('a'), span('b', 'string'), span('cd', 'plain')])
    const far = Array.from({ length: 50 }, (_, i) => span(String(i % 10), i % 2 ? 'string' : 'keyword'))
    const capped = capLineSpans(far, 3)
    expect(capped).toHaveLength(3)
    expect(capped.map((s) => s.text).join('')).toBe(far.map((s) => s.text).join(''))
  })

  it('keeps a budget of one to a single plain span', () => {
    expect(capLineSpans([span('a'), span('b', 'string')], 1)).toEqual([span('ab', 'plain')])
  })
})
