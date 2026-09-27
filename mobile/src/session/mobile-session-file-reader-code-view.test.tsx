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
    ActivityIndicator: 'ActivityIndicator',
    FlatList: 'FlatList',
    Image: 'Image',
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    Text: 'Text',
    View: 'View',
    Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
    StyleSheet: { create: (s: unknown) => s, flatten, hairlineWidth: 1 },
    useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1, scale: 3 })
  }
})
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

// Sentinel palettes: every role a colour no real palette uses, so a span can
// only carry one of these if the viewer read it from the theme.
function sentinelPalette(prefix: string) {
  const roles = [
    'surface', 'gutter', 'indentGuide', 'plain', 'comment', 'keyword', 'control',
    'string', 'number', 'literal', 'builtIn', 'type', 'function', 'attribute',
    'property', 'variable', 'punctuation', 'tag', 'meta', 'bracket1', 'bracket2', 'bracket3'
  ]
  return Object.fromEntries(
    roles.map((role, index) => [role, `#${prefix}${String(index).padStart(4, '0')}`])
  )
}
const SYNTAX = { light: sentinelPalette('A1'), dark: sentinelPalette('D1') }
let scheme: 'light' | 'dark' = 'dark'
vi.mock('../theme/theme-context', async () => {
  const tokens = await vi.importActual<typeof import('../theme/tokens')>('../theme/tokens')
  const useTheme = () => ({
    colors: tokens.colorsForScheme(scheme),
    syntax: SYNTAX[scheme],
    fonts: tokens.fontFamily,
    space: tokens.space,
    radius: tokens.radius,
    type: tokens.type,
    isDark: scheme === 'dark'
  })
  return {
    useTheme,
    // The session styles this file reads through are a factory of the live theme, same as
    // mobile-file-preview-styles.ts's, so a mocked theme-context needs to actually run it.
    useThemedStyles: <T,>(factory: (theme: ReturnType<typeof useTheme>) => T) => factory(useTheme())
  }
})

import { FileReader } from './MobileSessionFileReader'

const PYTHON = [
  'import dataclasses, json, os, sys',
  '',
  'def cell(em, ds, K, T=None, **bridge):',
  "    cfg = arch(K) if not bridge else dataclasses.replace(arch(K), name=f'K{K}_var', **bridge)",
  '    return cfg'
].join('\n')

let renderer: ReactTestRenderer | null = null

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
})

function renderFile(content: string, relativePath: string, onAskAboutLines = vi.fn()) {
  act(() => {
    renderer = create(
      createElement(FileReader, {
        doc: { status: 'ready', kind: 'file', content, truncated: false, byteLength: content.length },
        title: relativePath,
        relativePath,
        onAskAboutLines
      })
    )
  })
  // The highlighter runs one tick after the plain text paints.
  act(() => {
    vi.runAllTimers()
  })
  return renderer!
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

function spanColour(rendered: ReactTestRenderer, text: string): unknown {
  const span = rendered.root
    .findAllByType('Text' as never)
    .find((node) => node.children.length === 1 && node.children[0] === text)
  expect(span, `a span reading ${JSON.stringify(text)}`).toBeDefined()
  return flat(span!.props.style).color
}

describe('reading a code file on the phone', () => {
  it('keeps a long line on one row and scrolls the whole file sideways, so the indentation lines up', () => {
    // Why: 2026-09-26 screenshot — lever_energy.py wrapped its long lines onto
    // continuation rows, and the indentation of the next line no longer read.
    const r = renderFile(PYTHON, 'src/lever_energy.py')
    const sideways = r.root.findAll(
      (node) => (node.type as unknown) === 'ScrollView' && node.props.horizontal === true
    )
    expect(sideways).toHaveLength(1)
    expect(sideways[0]!.findAllByType('FlatList' as never)).toContain(list(r))
    // Wide enough for the longest line, so nothing inside has to wrap.
    const longest = Math.max(...PYTHON.split('\n').map((line) => line.length))
    expect(flat(list(r).props.style).minWidth).toBeGreaterThan(longest * 7)
    // Every row one line tall, and the list knows it without measuring.
    const layout = list(r).props.getItemLayout(list(r).props.data, 3)
    expect(layout.offset).toBe(layout.length * 3)
    const code = row(r, 3)
      .root.findAllByType('Text' as never)
      .find((node) => node.props.numberOfLines !== undefined)
    expect(code?.props.numberOfLines).toBe(1)
  })

  it.each(['light', 'dark'] as const)(
    'paints the code in the %s theme’s own syntax palette',
    (name) => {
      scheme = name
      const r = renderFile(PYTHON, 'src/lever_energy.py')
      const palette = SYNTAX[name]
      const importRow = row(r, 0)
      expect(spanColour(importRow, 'import')).toBe(palette.control)
      const defRow = row(r, 2)
      expect(spanColour(defRow, 'def')).toBe(palette.keyword)
      expect(spanColour(defRow, 'cell')).toBe(palette.function)
      expect(spanColour(defRow, 'None')).toBe(palette.literal)
      const surfaces = r.root.findAll((node) => flat(node.props.style).backgroundColor === palette.surface)
      expect(surfaces.length).toBeGreaterThan(0)
    }
  )

  it('opens a minified JSON file pretty-printed, and turns line ranges off since its lines are not the file’s', () => {
    const r = renderFile('{"name":"orca","tags":["a","b"],"nested":{"on":true}}', 'config/settings.json')
    const lines = list(r).props.data as unknown[]
    expect(lines.length).toBeGreaterThan(5)
    // A long-press still opens the bar, for the whole file alone
    // (mobile-session-file-reader-json-ask-about-file.test): no line is
    // highlighted and a tap extends nothing.
    const row = () => list(r).props.renderItem({ item: lines[1], index: 1 })
    act(() => {
      row().props.onLongPress()
    })
    expect(row().props.highlighted).toBe(false)
    expect(row().props.onPress).toBeUndefined()
    const notice = r.root
      .findAllByType('Text' as never)
      .map((node) => node.children.join(''))
      .find((text) => text.includes('Formatted'))
    expect(notice).toBeDefined()
  })

  it('shows an already formatted JSON file exactly as it is, with line selection on', () => {
    const formatted = '{\n    "name": "orca"\n}\n'
    const r = renderFile(formatted, 'config/settings.json')
    expect((list(r).props.data as unknown[]).length).toBe(4)
    expect(list(r).props.renderItem({ item: null, index: 1 }).props.onLongPress).toBeTypeOf('function')
  })
})
