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
vi.mock('./MobileSessionDiffLineRow', () => ({ DiffLineRow: 'DiffLineRow' }))
vi.mock('./mobile-session-styles', () => ({ styles: {} }))
vi.mock('../ui/Txt', () => ({ Txt: 'Txt' }))

let scheme: 'light' | 'dark' = 'dark'
vi.mock('../theme/theme-context', async () => {
  const tokens = await vi.importActual<typeof import('../theme/tokens')>('../theme/tokens')
  const palettes = await vi.importActual<typeof import('../theme/syntax-palette')>('../theme/syntax-palette')
  return {
    useTheme: () => ({
      colors: tokens.colorsForScheme(scheme),
      syntax: palettes.syntaxPaletteForScheme(scheme),
      fonts: tokens.fontFamily,
      space: tokens.space,
      radius: { ...tokens.radius, xl: 24 },
      type: { ...tokens.type, label: { size: 13 } },
      isDark: scheme === 'dark'
    })
  }
})

import { FileReader } from './MobileSessionFileReader'

// A minified settings file: the reader pretty-prints it, so its line numbers
// are not the file's and ranges stay off, but the file is still askable.
const MINIFIED_JSON = '{"name":"orca","tags":["a","b"],"nested":{"on":true}}\n'

let renderer: ReactTestRenderer | null = null
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
})

function open(onAskAboutLines = vi.fn()): ReturnType<typeof vi.fn> {
  act(() => {
    renderer = create(
      createElement(FileReader, {
        doc: { status: 'ready', kind: 'file', content: MINIFIED_JSON, truncated: false, byteLength: MINIFIED_JSON.length },
        title: 'settings.json',
        relativePath: 'config/settings.json',
        onAskAboutLines
      } as never)
    )
  })
  act(() => {
    vi.runAllTimers()
  })
  return onAskAboutLines
}

function rowElements(): ReactElement[] {
  const list = renderer!.root.findByType('FlatList' as never) as ReactTestInstance
  const data = list.props.data as unknown[]
  return data.map((item, index) => list.props.renderItem({ item, index }) as ReactElement)
}

function rowProps(index: number): Record<string, unknown> {
  return rowElements()[index]!.props as Record<string, unknown>
}

function actionBar(): ReactTestInstance | null {
  return renderer!.root.findAll((node) => node.props.testID === 'file-reader-line-action-bar')[0] ?? null
}

function button(label: string): ReactTestInstance | undefined {
  return renderer!.root
    .findAll((node) => node.props.accessibilityLabel === label)
    .find((node) => typeof node.props.onPress === 'function')
}

describe.each(['dark', 'light'] as const)('asking the chat about a minified JSON file from its tab (%s)', (current) => {
  beforeEach(() => {
    scheme = current
  })

  it('still offers "Ask about file" for a one-line JSON file', () => {
    const onAskAboutLines = open()
    // Any row the reader can long-press opens the action bar, whose file
    // button asks about the whole file. On main the one line could be pressed.
    const pressable = rowElements().find(
      (element) => typeof (element.props as { onLongPress?: unknown }).onLongPress === 'function'
    )
    expect(pressable, 'a row that can be long-pressed').toBeDefined()
    act(() => {
      ;(pressable!.props as { onLongPress: () => void }).onLongPress()
    })
    const askFile = button('Ask about file')
    expect(askFile).toBeDefined()
    act(() => {
      askFile!.props.onPress()
    })
    expect(onAskAboutLines).toHaveBeenCalledTimes(1)
    expect(onAskAboutLines).toHaveBeenCalledWith(null)
    expect(actionBar()).toBeNull()
  })

  it('offers no range and highlights no lines there, since the numbers are not the file\'s', () => {
    open()
    act(() => {
      ;(rowProps(2).onLongPress as () => void)()
    })
    expect(actionBar()).not.toBeNull()
    expect(renderer!.root.findAll((node) => /^Ask about lines? /.test(String(node.props.accessibilityLabel ?? ''))))
      .toEqual([])
    expect(rowElements().some((element) => (element.props as { highlighted?: boolean }).highlighted)).toBe(false)
    // A tap does not extend a range that is not there.
    expect(rowProps(4).onPress).toBeUndefined()
  })

  it('closes the bar without asking when it is dismissed', () => {
    const onAskAboutLines = open()
    act(() => {
      ;(rowProps(0).onLongPress as () => void)()
    })
    act(() => {
      button('Cancel line selection')!.props.onPress()
    })
    expect(onAskAboutLines).not.toHaveBeenCalled()
    expect(actionBar()).toBeNull()
  })
})
