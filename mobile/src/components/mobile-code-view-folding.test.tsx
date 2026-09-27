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

let scheme: 'light' | 'dark' = 'dark'
vi.mock('../theme/theme-context', async () => {
  const tokens = await vi.importActual<typeof import('../theme/tokens')>('../theme/tokens')
  const palettes = await vi.importActual<typeof import('../theme/syntax-palette')>('../theme/syntax-palette')
  return {
    useTheme: () => ({
      colors: tokens.colorsForScheme(scheme),
      syntax: palettes.syntaxPaletteForScheme(scheme),
      fonts: tokens.fontFamily,
      isDark: scheme === 'dark'
    })
  }
})

import { MobileCodeView } from './MobileCodeView'
import {
  CODE_VIEW_WHOLE_FILE_HIGHLIGHT_CHARS,
  buildMobileCodeDocument,
  type MobileCodeDocument
} from './mobile-code-document'
import { colorBracketPairs } from './mobile-syntax-brackets'
import { splitSyntaxIntoLines } from './mobile-syntax-lines'
import { highlightMobileCode } from '../session/mobile-file-syntax'
import { codeViewMetrics } from './mobile-code-view-layout'
import { contrastRatio } from '../test/contrast'
import { syntaxPaletteForScheme } from '../theme/syntax-palette'

const PYTHON = [
  'def cell(em):', // 1
  '    for r in em:', // 2
  '        yield r', // 3
  '', // 4
  '    return None', // 5
  '', // 6
  'def other():', // 7
  '    pass' // 8
].join('\n')

let renderers: ReactTestRenderer[] = []
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  act(() => renderers.forEach((r) => r.unmount()))
  renderers = []
  vi.useRealTimers()
})

function mount(document: MobileCodeDocument): ReactTestRenderer {
  let r: ReactTestRenderer | null = null
  act(() => {
    r = create(createElement(MobileCodeView, { document, accessibilityLabel: 'file preview' }))
  })
  renderers.push(r!)
  act(() => {
    vi.runAllTimers()
  })
  return r!
}

function list(r: ReactTestRenderer): ReactTestInstance {
  return r.root.findByType('FlatList' as never) as ReactTestInstance
}

/** List row `index` as the FlatList would draw it. */
function row(r: ReactTestRenderer, index: number): ReactTestRenderer {
  const element = list(r).props.renderItem({ item: list(r).props.data[index], index }) as ReactElement
  let drawn: ReactTestRenderer | null = null
  act(() => {
    drawn = create(element)
  })
  renderers.push(drawn!)
  return drawn!
}

function text(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map((child) => text(child as ReactTestInstance | string)).join('')
}

/** The line numbers the list draws, top to bottom. */
function numbers(r: ReactTestRenderer): string[] {
  const count = (list(r).props.data as unknown[]).length
  return Array.from({ length: count }, (_, index) => text(row(r, index).root.findAllByType('Text' as never)[0]!).trim())
}

/** Draws row `index`, then presses its fold toggle: a row drawn inside
 *  act() is not mounted until the act ends. */
function pressToggle(r: ReactTestRenderer, index: number, label: string): void {
  const target = toggle(row(r, index), label)
  act(() => {
    target.props.onPress()
  })
}

function pressMarker(r: ReactTestRenderer, index: number): void {
  const marker = row(r, index).root.find((node) => node.props.testID === 'code-fold-marker')
  act(() => {
    marker.props.onPress()
  })
}

function toggle(drawn: ReactTestRenderer, label: string): ReactTestInstance {
  return drawn.root.find((node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')
}

function flat(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.filter(Boolean).map(flat))
  }
  return (style ?? {}) as Record<string, unknown>
}

describe.each(['dark', 'light'] as const)('folding a block of code (%s)', (current) => {
  beforeEach(() => {
    scheme = current
  })

  it('puts a ▾ toggle on the first line of each block, a button named for the lines it folds', () => {
    const r = mount(buildMobileCodeDocument(PYTHON, 'python'))
    const first = toggle(row(r, 0), 'Fold lines 1–5')
    expect(first.props.accessibilityRole).toBe('button')
    expect(first.props.accessibilityState).toEqual({ expanded: true })
    expect(text(first)).toBe('▾')
    toggle(row(r, 1), 'Fold lines 2–3')
    toggle(row(r, 6), 'Fold lines 7–8')
    // A line that starts no block has no toggle.
    expect(row(r, 2).root.findAll((node) => /^(Un)?[Ff]old lines/.test(String(node.props.accessibilityLabel ?? '')))).toEqual([])
  })

  it('hides a folded block\'s lines, keeps the file\'s own line numbers, and ends the header with …', () => {
    const r = mount(buildMobileCodeDocument(PYTHON, 'python'))
    pressToggle(r, 1, 'Fold lines 2–3')
    expect(numbers(r)).toEqual(['1', '2', '4', '5', '6', '7', '8'])
    const header = row(r, 1)
    const unfold = toggle(header, 'Unfold lines 2–3')
    expect(unfold.props.accessibilityState).toEqual({ expanded: false })
    expect(text(unfold)).toBe('▸')
    expect(text(header.root.find((node) => node.props.testID === 'code-fold-marker'))).toContain('…')
  })

  it('unfolds from the ▸ toggle, or from the … marker', () => {
    const r = mount(buildMobileCodeDocument(PYTHON, 'python'))
    pressToggle(r, 0, 'Fold lines 1–5')
    expect(numbers(r)).toEqual(['1', '6', '7', '8'])
    pressMarker(r, 0)
    expect(numbers(r)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
    pressToggle(r, 0, 'Fold lines 1–5')
    pressToggle(r, 0, 'Unfold lines 1–5')
    expect(numbers(r)).toHaveLength(8)
  })

  it('keeps an inner fold folded while its outer block folds and unfolds', () => {
    const r = mount(buildMobileCodeDocument(PYTHON, 'python'))
    pressToggle(r, 1, 'Fold lines 2–3')
    pressToggle(r, 0, 'Fold lines 1–5')
    expect(numbers(r)).toEqual(['1', '6', '7', '8'])
    pressToggle(r, 0, 'Unfold lines 1–5')
    expect(numbers(r)).toEqual(['1', '2', '4', '5', '6', '7', '8'])
  })

  it('folds the last block of the file down to its last line', () => {
    const r = mount(buildMobileCodeDocument(PYTHON, 'python'))
    pressToggle(r, 6, 'Fold lines 7–8')
    expect(numbers(r)).toEqual(['1', '2', '3', '4', '5', '6', '7'])
  })

  it('draws the toggles and the marker in colours that read on the code, and on a selected line', () => {
    const palette = syntaxPaletteForScheme(current)
    const r = mount(buildMobileCodeDocument(PYTHON, 'python'))
    const colour = (node: ReactTestInstance) => flat(node.props.style).color as string
    const glyph = (drawn: ReactTestRenderer, label: string) => toggle(drawn, label).findByType('Text' as never)
    expect(contrastRatio(colour(glyph(row(r, 0), 'Fold lines 1–5')), palette.surface)).toBeGreaterThanOrEqual(4.5)
    pressToggle(r, 0, 'Fold lines 1–5')
    const marker = row(r, 0).root.find((node) => node.props.testID === 'code-fold-marker')
    expect(contrastRatio(colour(marker), palette.surface)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(colour(marker), palette.selection)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(colour(glyph(row(r, 0), 'Unfold lines 1–5')), palette.surface)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('a file with nothing to fold', () => {
  it('keeps the old gap after its line numbers, with no fold column', () => {
    // Plain text and logs drew an empty toggle column (review, 2026-09-27).
    const log = Array.from({ length: 30 }, (_, i) => `2026-09-27 01:0${i % 10} INFO request ${i} done`).join('\n')
    const doc = buildMobileCodeDocument(log, 'plaintext')
    expect(doc.folds).toEqual([])
    const r = mount(doc)
    const drawn = row(r, 0)
    expect(drawn.root.findAll((node) => node.props.testID === 'code-fold-column')).toEqual([])
    const metrics = codeViewMetrics({ lineCount: 30, maxColumns: doc.maxColumns, fontScale: 1, foldable: false })
    // Two digits and the 14-point gap the gutter always had.
    expect(metrics.gutterWidth).toBe(Math.ceil(2 * metrics.cellWidth + 14))
    expect(flat(drawn.root.findAllByType('Text' as never)[0]!.props.style).width).toBe(metrics.gutterWidth)
  })

  it('keeps the column in a file with blocks, on rows that start none too', () => {
    const r = mount(buildMobileCodeDocument(PYTHON, 'python'))
    expect(row(r, 2).root.findAll((node) => node.props.testID === 'code-fold-column')).toHaveLength(1)
  })
})

describe('the folds of a file', () => {
  it('reset when the file\'s content changes, and last through a wrap toggle', () => {
    const doc = buildMobileCodeDocument(PYTHON, 'python')
    const r = mount(doc)
    pressToggle(r, 0, 'Fold lines 1–5')
    act(() => {
      r.root.findByProps({ accessibilityLabel: 'Wrap lines' }).props.onPress()
    })
    expect(numbers(r)).toEqual(['1', '6', '7', '8'])
    act(() => {
      r.update(
        createElement(MobileCodeView, {
          document: buildMobileCodeDocument(`${PYTHON}\n`, 'python'),
          accessibilityLabel: 'file preview'
        })
      )
    })
    expect(numbers(r)).toHaveLength(9)
  })

  it('keep the reader on the same line across a wrap toggle, counted in rows the list draws', () => {
    const lines = Array.from({ length: 60 }, (_, i) => (i % 10 === 0 ? `def f${i}():` : `    x = ${i}`))
    const r = mount(buildMobileCodeDocument(lines.join('\n'), 'python'))
    pressToggle(r, 0, 'Fold lines 1–10')
    // Row 5 of the folded list is line 15 (0-based 14): lines 2–10 are hidden.
    expect(text(row(r, 5).root.findAllByType('Text' as never)[0]!).trim()).toBe('15')
    act(() => list(r).props.onViewableItemsChanged({ viewableItems: [{ index: 5 }, { index: 20 }] }))
    act(() => {
      r.root.findByProps({ accessibilityLabel: 'Wrap lines' }).props.onPress()
    })
    act(() => {
      r.root.findByProps({ accessibilityLabel: 'Wrap lines' }).props.onPress()
    })
    expect(list(r).props.initialScrollIndex).toBe(5)
    // Fixed rows: the list places row 5 without measuring.
    expect(list(r).props.getItemLayout(null, 5).index).toBe(5)
  })

  it('colour the lines after a fold from their own chunk, brackets at the depth the whole file gives them', () => {
    const methods = Array.from(
      { length: Math.ceil(CODE_VIEW_WHOLE_FILE_HIGHLIGHT_CHARS / 40) + 10 },
      (_, i) => `  method${i}(value) { return value + ${i} }`
    )
    const source = ['class Store {', '  first() {', ...methods.map((line) => `  ${line}`), '  }', ...methods, '}', ''].join('\n')
    const doc = buildMobileCodeDocument(source, 'typescript')
    expect(doc.highlight).toBe('chunked')
    const r = mount(doc)
    // Fold `first() {` — thousands of lines, chunks of them — away.
    const firstEnd = methods.length + 1
    pressToggle(r, 1, `Fold lines 2–${firstEnd + 1}`)
    // The rows after the fold come into view.
    act(() => list(r).props.onViewableItemsChanged({ viewableItems: [{ index: 2 }, { index: 30 }] }))
    act(() => {
      vi.runAllTimers()
    })
    const lineIndex = firstEnd + 5 // a method of the class, past the fold
    const listIndex = lineIndex - (firstEnd - 1)
    expect(text(row(r, listIndex).root.findAllByType('Text' as never)[0]!).trim()).toBe(String(lineIndex + 1))
    const whole = colorBracketPairs(
      splitSyntaxIntoLines(highlightMobileCode(source, 'typescript', Infinity, Infinity).segments)
    )
    const palette = syntaxPaletteForScheme(scheme)
    const bracketColour = (kind: string) => palette[kind as keyof typeof palette]
    const expected = whole[lineIndex]!.filter((s) => /^[()[\]{}]$/.test(s.text)).map((s) => bracketColour(s.kind))
    const code = row(r, listIndex).root.find((node) => node.type === ('Text' as never) && node.props.ellipsizeMode === 'clip')
    const drawn = code
      .findAll((node) => node.type === ('Text' as never) && node !== code && /^[()[\]{}]$/.test(text(node)))
      .map((node) => flat(node.props.style).color as string)
    expect(expected.length).toBeGreaterThan(0)
    expect(drawn).toEqual(expected)
  })
})
