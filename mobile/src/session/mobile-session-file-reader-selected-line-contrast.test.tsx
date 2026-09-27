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
vi.mock('./MobileSessionDiffLineRow', () => ({ DiffLineRow: 'DiffLineRow' }))
vi.mock('./mobile-session-styles', () => ({ sessionStyles: () => ({}) }))
vi.mock('../ui/Txt', () => ({ Txt: 'Txt' }))

let scheme: 'light' | 'dark' = 'light'
vi.mock('../theme/theme-context', async () => {
  const tokens = await vi.importActual<typeof import('../theme/tokens')>('../theme/tokens')
  const palettes = await vi.importActual<typeof import('../theme/syntax-palette')>('../theme/syntax-palette')
  const useTheme = () => ({
    colors: tokens.colorsForScheme(scheme),
    syntax: palettes.syntaxPaletteForScheme(scheme),
    fonts: tokens.fontFamily,
    space: tokens.space,
    radius: { ...tokens.radius, xl: 24 },
    type: { ...tokens.type, label: { size: 13 } },
    isDark: scheme === 'dark'
  })
  return {
    useTheme,
    useThemedStyles: <T,>(factory: (theme: ReturnType<typeof useTheme>) => T) => factory(useTheme())
  }
})

import { FileReader } from './MobileSessionFileReader'
import { contrastRatio } from '../test/contrast'
import { syntaxPaletteForScheme, SYNTAX_TOKEN_ROLES } from '../theme/syntax-palette'

const SOURCE = ['def cell(em):  # the cell', '    for r in em:', '        yield r'].join('\n')

let renderers: ReactTestRenderer[] = []
afterEach(() => {
  act(() => renderers.forEach((r) => r.unmount()))
  renderers = []
})

type Style = Record<string, unknown>
function flatten(style: unknown): Style {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.filter(Boolean).map(flatten)) as Style
  }
  return (style ?? {}) as Style
}

/** The reader with its second line long-pressed for "Ask about lines", and
 *  that line's row as the list draws it. */
function selectedRow(): { fill: string; lineNumber: string } {
  let reader: ReactTestRenderer | null = null
  act(() => {
    reader = create(
      createElement(FileReader, {
        doc: { status: 'ready', kind: 'file', content: SOURCE, truncated: false, byteLength: SOURCE.length },
        title: 'lever_energy.py',
        relativePath: 'algorithm/lever_energy.py',
        onAskAboutLines: vi.fn()
      } as never)
    )
  })
  renderers.push(reader!)
  const list = () => reader!.root.findByType('FlatList' as never) as ReactTestInstance
  const rowElement = () => list().props.renderItem({ item: list().props.data[1], index: 1 }) as ReactElement
  act(() => {
    ;(rowElement().props as { onLongPress: () => void }).onLongPress()
  })
  let row: ReactTestRenderer | null = null
  act(() => {
    row = create(rowElement())
  })
  renderers.push(row!)
  const rowView = row!.root.findAll((node) => node.type === ('View' as never))[0]!
  // The number is the row's first Text; the code's is the one that clips.
  const gutter = row!.root.findAllByType('Text' as never)[0]!
  expect(gutter.props.ellipsizeMode).toBeUndefined()
  return {
    fill: flatten(rowView.props.style).backgroundColor as string,
    lineNumber: flatten(gutter.props.style).color as string
  }
}

describe.each(['light', 'dark'] as const)('a line selected to ask about (%s)', (current) => {
  beforeEach(() => {
    scheme = current
  })

  it('keeps its line number readable on the highlight', () => {
    const { fill, lineNumber } = selectedRow()
    expect(fill, 'the row is highlighted').toBeTruthy()
    expect(contrastRatio(lineNumber, fill), `${lineNumber} on ${fill}`).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps every code colour readable on the highlight', () => {
    const { fill } = selectedRow()
    const palette = syntaxPaletteForScheme(current)
    const low = SYNTAX_TOKEN_ROLES.map((role) => [role, palette[role], contrastRatio(palette[role], fill)] as const)
      .filter(([, , ratio]) => ratio < 4.5)
      .map(([role, colour, ratio]) => `${role} ${colour} ${ratio.toFixed(2)}:1`)
    expect(low, `on ${fill}`).toEqual([])
  })

  it('still sets the selected rows apart from the rest of the file', () => {
    const { fill, lineNumber } = selectedRow()
    const palette = syntaxPaletteForScheme(current)
    expect(fill).not.toBe(palette.surface)
    expect(lineNumber).not.toBe(palette.gutter)
  })
})
