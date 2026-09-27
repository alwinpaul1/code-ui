import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  FlatList: 'FlatList',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
  useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1, scale: 3 })
}))
vi.mock('lucide-react-native', () => ({ Check: 'Check', Copy: 'Copy', WrapText: 'WrapText' }))
// The code viewer's Copy button writes through this; expo-clipboard cannot load here.
vi.mock('../platform/clipboard', () => ({ useClipboardWriter: () => ({ writeText: vi.fn() }) }))
vi.mock('../theme/theme-context', async () => {
  const tokens = await vi.importActual<typeof import('../theme/tokens')>('../theme/tokens')
  const palettes = await vi.importActual<typeof import('../theme/syntax-palette')>('../theme/syntax-palette')
  return {
    useTheme: () => ({
      colors: tokens.colorsForScheme('dark'),
      syntax: palettes.syntaxPaletteForScheme('dark'),
      fonts: tokens.fontFamily,
      isDark: true
    })
  }
})

/** Lines the bracket-depth scan reads, counted as it goes. */
const scan = vi.hoisted(() => ({ lines: 0 }))
vi.mock('./mobile-code-bracket-depth', async () => {
  const actual = await vi.importActual<typeof import('./mobile-code-bracket-depth')>('./mobile-code-bracket-depth')
  return {
    ...actual,
    scanBracketDepth: (...args: Parameters<typeof actual.scanBracketDepth>) => {
      scan.lines += args[2] - args[1]
      return actual.scanBracketDepth(...args)
    }
  }
})

import { MobileCodeView } from './MobileCodeView'
import { CODE_VIEW_HIGHLIGHT_CHUNK_LINES, CODE_VIEW_WHOLE_FILE_HIGHLIGHT_CHARS, buildMobileCodeDocument } from './mobile-code-document'
import { syntaxPaletteForScheme } from '../theme/syntax-palette'

let renderers: ReactTestRenderer[] = []
beforeEach(() => {
  vi.useFakeTimers()
  scan.lines = 0
})
afterEach(() => {
  act(() => renderers.forEach((r) => r.unmount()))
  renderers = []
  vi.useRealTimers()
})

describe('opening a big file at its end', () => {
  it('finds the bracket depth there over several ticks, not in one long one, and still colours the line', () => {
    // A 3.9 MB file opened at its last line scanned every line above it in
    // one timer: 309 ms on Hermes (review, 2026-09-27).
    const unit = '  method(value) { return [value, (value + 1)] }\n'
    const source = `class Store {\n${unit.repeat(Math.ceil((CODE_VIEW_WHOLE_FILE_HIGHLIGHT_CHARS * 8) / unit.length))}}\n`
    const doc = buildMobileCodeDocument(source, 'typescript')
    expect(doc.highlight).toBe('chunked')
    // The last method: the file ends `}` and a trailing newline.
    const lastLine = doc.lines.length - 3
    expect(doc.lines[lastLine]).toBe(unit.trimEnd())
    expect(lastLine).toBeGreaterThan(CODE_VIEW_HIGHLIGHT_CHUNK_LINES * 20)

    // Measure what each timer callback scans.
    let most = 0
    const setTimer = globalThis.setTimeout
    const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void, ms?: number) =>
      setTimer(() => {
        const before = scan.lines
        callback()
        most = Math.max(most, scan.lines - before)
      }, ms)) as typeof setTimeout)
    let r: ReactTestRenderer | null = null
    try {
      act(() => {
        r = create(createElement(MobileCodeView, { document: doc, accessibilityLabel: 'file preview', initialLine: lastLine + 1 }))
      })
      renderers.push(r!)
      act(() => {
        vi.runAllTimers()
      })
    } finally {
      spy.mockRestore()
    }
    expect(scan.lines).toBeGreaterThan(CODE_VIEW_HIGHLIGHT_CHUNK_LINES * 20)
    expect(most).toBeLessThanOrEqual(CODE_VIEW_HIGHLIGHT_CHUNK_LINES * 4)

    // And the line is coloured, its brackets one level into the class.
    const list = r!.root.findByType('FlatList' as never) as ReactTestInstance
    const element = list.props.renderItem({ item: list.props.data[lastLine], index: lastLine }) as ReactElement
    let drawn: ReactTestRenderer | null = null
    act(() => {
      drawn = create(element)
    })
    renderers.push(drawn!)
    const palette = syntaxPaletteForScheme('dark')
    const code = drawn!.root.find((node) => node.type === ('Text' as never) && node.props.ellipsizeMode === 'clip')
    const firstParen = code
      .findAll((node) => node.type === ('Text' as never) && node !== code)
      .find((node) => node.children.join('') === '(')
    expect((firstParen!.props.style as { color: string }).color).toBe(palette.bracket2)
  })
})
