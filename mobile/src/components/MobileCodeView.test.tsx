import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => {
  function flatten(style: unknown): Record<string, unknown> | undefined {
    if (style == null || style === false) {
      return undefined
    }
    if (Array.isArray(style)) {
      return Object.assign({}, ...style.map((item) => flatten(item) ?? {}))
    }
    return typeof style === 'object' ? { ...(style as Record<string, unknown>) } : undefined
  }
  return {
    FlatList: 'FlatList',
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    Text: 'Text',
    View: 'View',
    StyleSheet: { create: (s: unknown) => s, flatten, hairlineWidth: 1 },
    useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1, scale: 3 })
  }
})
vi.mock('lucide-react-native', () => ({ WrapText: 'WrapText' }))

import { darkSyntaxPalette, lightSyntaxPalette } from '../theme/syntax-palette'
import { fontFamily } from '../theme/tokens'

let scheme: 'light' | 'dark' = 'dark'
vi.mock('../theme/theme-context', async () => {
  const tokens = await vi.importActual<typeof import('../theme/tokens')>('../theme/tokens')
  const palettes = await vi.importActual<typeof import('../theme/syntax-palette')>(
    '../theme/syntax-palette'
  )
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
  CODE_VIEW_HIGHLIGHT_CHUNK_LINES,
  CODE_VIEW_WHOLE_FILE_HIGHLIGHT_CHARS,
  buildMobileCodeDocument,
  type MobileCodeDocument
} from './mobile-code-document'
import { CODE_VIEW_MAX_NO_WRAP_COLUMNS, codeViewMetrics } from './mobile-code-view-layout'

const PYTHON = [
  'def cell(em, ds, K):',
  '    for r in sets[K]:',
  '        e = em.estimate(r)',
  '    return e'
].join('\n')

let renderer: ReactTestRenderer | null = null

beforeEach(() => {
  vi.useFakeTimers()
  scheme = 'dark'
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
})

function mount(document: MobileCodeDocument, props: { initialLine?: number; notice?: string } = {}) {
  act(() => {
    renderer = create(
      createElement(MobileCodeView, { document, accessibilityLabel: 'file preview', ...props })
    )
  })
  return renderer!
}

function settle() {
  act(() => {
    vi.runAllTimers()
  })
}

function list(r: ReactTestRenderer): ReactTestInstance {
  return r.root.findByType('FlatList' as never)
}

function row(r: ReactTestRenderer, index: number): ReactTestRenderer {
  const element = list(r).props.renderItem({ item: list(r).props.data[index], index }) as ReactElement
  let rendered: ReactTestRenderer | null = null
  act(() => {
    rendered = create(element)
  })
  return rendered!
}

function flat(style: unknown): Record<string, unknown> {
  const items = Array.isArray(style) ? style.flat(4) : [style]
  return Object.assign({}, ...items.filter((item) => item && typeof item === 'object'))
}

function guidesOf(rendered: ReactTestRenderer): ReactTestInstance[] {
  return rendered.root.findAll((node) => node.props.testID === 'code-indent-guide')
}

/** The role of each coloured span in a row, read back from its colour. Dark+
 *  shares a colour between some roles (keyword and literal are one blue), so
 *  the first role in palette order names it. The line number is not a span. */
function spanKinds(rendered: ReactTestRenderer, palette: Record<string, string>): string[] {
  const byColour = new Map<string, string>()
  for (const [role, colour] of Object.entries(palette)) {
    if (!byColour.has(colour)) {
      byColour.set(colour, role)
    }
  }
  return rendered.root
    .findAllByType('Text' as never)
    .filter((node) => node.children.length === 1 && typeof node.children[0] === 'string')
    .map((node) => byColour.get(String(flat(node.props.style).color)) ?? 'unknown')
    .filter((role) => role !== 'gutter')
}

describe.each([
  ['light', lightSyntaxPalette],
  ['dark', darkSyntaxPalette]
] as const)('the code viewer in %s mode', (name, palette) => {
  beforeEach(() => {
    scheme = name
  })

  it('draws one faint guide per indent level at its column', () => {
    const r = mount(buildMobileCodeDocument(PYTHON, 'python'))
    const metrics = codeViewMetrics({ lineCount: 4, maxColumns: 26, fontScale: 1 })
    const deepest = guidesOf(row(r, 2))
    expect(deepest.map((guide) => flat(guide.props.style).left)).toEqual([0, 4 * metrics.cellWidth])
    for (const guide of deepest) {
      expect(flat(guide.props.style).backgroundColor).toBe(palette.indentGuide)
    }
    expect(guidesOf(row(r, 0))).toHaveLength(0)
  })

  it('paints the surface, the line numbers and the code in the scheme’s colours and the code face', () => {
    const r = mount(buildMobileCodeDocument(PYTHON, 'python'))
    settle()
    const surfaces = r.root.findAll((node) => flat(node.props.style).backgroundColor === palette.surface)
    expect(surfaces.length).toBeGreaterThan(0)
    const first = row(r, 0)
    const texts = first.root.findAllByType('Text' as never)
    const gutter = texts.find((node) => node.children.join('').trim() === '1')!
    expect(flat(gutter.props.style)).toMatchObject({ color: palette.gutter, fontFamily: fontFamily.mono })
    expect(spanKinds(first, palette)).toContain('keyword')
    expect(spanKinds(first, palette)).toContain('function')
    expect(spanKinds(first, palette)).not.toContain('unknown')
  })
})

describe('the code viewer', () => {
  it('shows the text at once and colours it a tick later', () => {
    const r = mount(buildMobileCodeDocument(PYTHON, 'python'))
    expect(spanKinds(row(r, 0), darkSyntaxPalette)).toEqual(['plain'])
    settle()
    expect(spanKinds(row(r, 0), darkSyntaxPalette)).toContain('keyword')
  })

  it('lets the reader turn wrapping on and back off', () => {
    const r = mount(buildMobileCodeDocument(PYTHON, 'python'))
    const toggle = () => r.root.findByProps({ accessibilityLabel: 'Wrap lines' })
    expect(toggle().props.accessibilityState).toEqual({ selected: false })
    act(() => toggle().props.onPress())
    expect(r.root.findAll((node) => node.props.horizontal === true)).toHaveLength(0)
    expect(list(r).props.getItemLayout).toBeUndefined()
    const wrapped = row(r, 2)
      .root.findAllByType('Text' as never)
      .filter((node) => node.props.numberOfLines === 1)
    expect(wrapped).toHaveLength(0)
    expect(toggle().props.accessibilityState).toEqual({ selected: true })
    act(() => toggle().props.onPress())
    expect(r.root.findAll((node) => node.props.horizontal === true)).toHaveLength(1)
  })

  it('keeps the reader on the same line when wrapping is turned on and off', () => {
    // Why: the list moves in and out of the sideways scroller when wrapping
    // flips, so it mounts afresh, and a fresh list starts at line 1.
    const lines = Array.from({ length: 300 }, (_, index) => `x${index} = ${index}`).join('\n')
    const scrollToIndex = vi.fn()
    act(() => {
      renderer = create(
        createElement(MobileCodeView, {
          document: buildMobileCodeDocument(lines, 'python'),
          accessibilityLabel: 'file preview'
        }),
        {
          createNodeMock: (element) =>
            (element.type as unknown) === 'FlatList' ? { scrollToIndex, scrollToOffset: vi.fn() } : null
        }
      )
    })
    const r = renderer!
    const toggle = () => r.root.findByProps({ accessibilityLabel: 'Wrap lines' })
    act(() => list(r).props.onViewableItemsChanged({ viewableItems: [{ index: 120 }, { index: 150 }] }))
    act(() => toggle().props.onPress())
    settle()
    expect(scrollToIndex).toHaveBeenCalledWith(expect.objectContaining({ index: 120, animated: false }))
    act(() => list(r).props.onViewableItemsChanged({ viewableItems: [{ index: 64 }] }))
    act(() => toggle().props.onPress())
    expect(list(r).props.initialScrollIndex).toBe(64)
  })

  it('opens a file with a line past the no-wrap limit wrapped, and cuts that line if unwrapped', () => {
    const long = `x = "${'a'.repeat(CODE_VIEW_MAX_NO_WRAP_COLUMNS + 50)}"`
    const r = mount(buildMobileCodeDocument(`${long}\ny = 1`, 'python'))
    expect(list(r).props.getItemLayout).toBeUndefined()
    act(() => r.root.findByProps({ accessibilityLabel: 'Wrap lines' }).props.onPress())
    const texts = row(r, 0).root.findAllByType('Text' as never).map((node) => node.children.join(''))
    expect(texts.some((text) => text.includes('more characters'))).toBe(true)
    expect(texts.join('').length).toBeLessThan(long.length)
  })

  it('colours a file too big for one pass where the reader is looking', () => {
    const block = 'def f(x):\n    return x + 1\n\n'
    const source = block.repeat(Math.ceil((CODE_VIEW_WHOLE_FILE_HIGHLIGHT_CHARS + 20_000) / block.length))
    const doc = buildMobileCodeDocument(source, 'python')
    expect(doc.highlight).toBe('chunked')
    const r = mount(doc)
    settle()
    expect(spanKinds(row(r, 0), darkSyntaxPalette)).toContain('keyword')
    const far = CODE_VIEW_HIGHLIGHT_CHUNK_LINES * 6
    expect(spanKinds(row(r, far), darkSyntaxPalette)).toEqual(['plain'])
    act(() => {
      list(r).props.onViewableItemsChanged({ viewableItems: [{ index: far }, { index: far + 30 }] })
    })
    settle()
    expect(spanKinds(row(r, far), darkSyntaxPalette)).toContain('keyword')
  })

  it('opens at the requested line, clamped to the file', () => {
    const doc = buildMobileCodeDocument(PYTHON, 'python')
    expect(list(mount(doc, { initialLine: 3 })).props.initialScrollIndex).toBe(2)
    act(() => renderer?.unmount())
    expect(list(mount(doc, { initialLine: 99 })).props.initialScrollIndex).toBe(3)
    act(() => renderer?.unmount())
    expect(list(mount(doc)).props.initialScrollIndex).toBeUndefined()
  })

  it('does not jump to a line of a pretty-printed file, whose line numbers are not the file’s', () => {
    const doc = buildMobileCodeDocument('{"a":{"b":[1,2]}}', 'json')
    expect(list(mount(doc, { initialLine: 4 })).props.initialScrollIndex).toBeUndefined()
  })

  it('shows a notice above the code', () => {
    const r = mount(buildMobileCodeDocument(PYTHON, 'python'), { notice: 'Preview truncated.' })
    const texts = r.root.findAllByType('Text' as never).map((node) => node.children.join(''))
    expect(texts).toContain('Preview truncated.')
  })

  it('renders an empty file as one empty numbered line', () => {
    const r = mount(buildMobileCodeDocument('', 'python'))
    settle()
    expect(list(r).props.data).toHaveLength(1)
    expect(guidesOf(row(r, 0))).toHaveLength(0)
  })
})
