import { createElement } from 'react'
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
const clipboard = vi.hoisted(() => ({ writeText: vi.fn() }))
vi.mock('../platform/clipboard', () => ({ useClipboardWriter: () => clipboard }))
vi.mock('../components/MobileHtmlPreview', () => ({ MobileHtmlPreview: 'MobileHtmlPreview' }))
vi.mock('../files/MobileFilePdfPreview', () => ({ MobileFilePdfPreview: 'MobileFilePdfPreview' }))
vi.mock('../files/MobileFileMarkdownPreview', () => ({ MobileFileMarkdownPreview: 'MobileFileMarkdownPreview' }))
vi.mock('./MobileSessionDiffLineRow', () => ({ DiffLineRow: 'DiffLineRow' }))
vi.mock('./mobile-session-styles', () => ({ styles: {}, sessionStyles: () => ({}) }))
vi.mock('../ui/Txt', () => ({ Txt: 'Txt' }))

let scheme: 'light' | 'dark' = 'dark'
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
import { colorsForScheme } from '../theme/tokens'

const LOADED = ['def cell(em):', '    return em'].join('\n')

let renderer: ReactTestRenderer | null = null
beforeEach(() => {
  vi.useFakeTimers()
  clipboard.writeText.mockReset().mockResolvedValue(undefined)
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
})

function open(truncated: boolean): void {
  act(() => {
    renderer = create(
      createElement(FileReader, {
        // Orca's files.read for any file over its cap: `byteLength` is what the host READ
        // (512 KiB and a byte), not the file's size, which the phone is never told.
        doc: { status: 'ready', kind: 'file', content: LOADED, truncated, byteLength: truncated ? 524_289 : LOADED.length },
        title: 'lever_energy.py',
        relativePath: 'algorithm/lever_energy.py',
        onAskAboutLines: vi.fn()
      } as never)
    )
  })
  act(() => {
    vi.runAllTimers()
  })
}

function textOf(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map((child) => textOf(child as ReactTestInstance | string)).join('')
}

function texts(): string[] {
  return renderer!.root.findAllByType('Text' as never).map((node) => textOf(node))
}

function flat(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.filter(Boolean).map(flat))
  }
  return (style ?? {}) as Record<string, unknown>
}

describe.each(['dark', 'light'] as const)('a file tab showing only part of a file (%s)', (current) => {
  beforeEach(() => {
    scheme = current
  })

  it('says the file was cut, never calling it 512 KB, and that Copy takes only the loaded text, in words on the button', async () => {
    open(true)
    const notes = texts().filter((text) => text.startsWith('Preview truncated'))
    expect(notes).toEqual(['Preview truncated: showing the first 512 KB of the file.'])
    const button = renderer!.root
      .findAll((node) => node.props.accessibilityLabel === 'Copy loaded text')
      .find((node) => typeof node.props.onPress === 'function')
    expect(button, 'a "Copy loaded text" button').toBeDefined()
    const label = button!.findAllByType('Text' as never).find((node) => textOf(node) === 'Copy loaded text')
    expect(label, 'the words on the button').toBeDefined()
    const colours = colorsForScheme(current)
    expect(contrastRatio(flat(label!.props.style).color as string, colours.bgPanel)).toBeGreaterThanOrEqual(4.5)
    await act(async () => {
      await button!.props.onPress()
    })
    expect(clipboard.writeText).toHaveBeenCalledWith(LOADED)
  })

  it('keeps "Copy file" and no notice for a file that came whole', () => {
    open(false)
    expect(texts().some((text) => text.startsWith('Preview truncated'))).toBe(false)
    expect(renderer!.root.findAll((node) => node.props.accessibilityLabel === 'Copy file').length).toBeGreaterThan(0)
    expect(renderer!.root.findAll((node) => node.props.accessibilityLabel === 'Copy loaded text')).toEqual([])
  })
})
