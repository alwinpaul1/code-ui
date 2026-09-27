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
vi.mock('./MobileFilePdfPreview', () => ({ MobileFilePdfPreview: 'MobileFilePdfPreview' }))
vi.mock('./MobileFileMarkdownPreview', () => ({ MobileFileMarkdownPreview: 'MobileFileMarkdownPreview' }))
vi.mock('../session/MobileSessionDiffLineRow', () => ({ DiffLineRow: 'DiffLineRow' }))
vi.mock('../session/mobile-session-styles', () => ({ styles: {}, sessionStyles: () => ({}) }))
vi.mock('../ui/Txt', () => ({ Txt: 'Txt' }))
vi.mock('./mobile-file-preview-request', () => ({
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
    radius: { ...tokens.radius, xl: 24 },
    type: { ...tokens.type, label: { size: 13 } },
    isDark: scheme === 'dark'
  })
  return {
    useTheme,
    // The file preview's styles are a factory of the live theme (mobile-file-preview-styles.ts).
    useThemedStyles: <T,>(factory: (theme: ReturnType<typeof useTheme>) => T) => factory(useTheme())
  }
})

import { MobileFilePreviewSourceText } from './MobileFilePreviewSourceText'
import { FileReader } from '../session/MobileSessionFileReader'
import { syntaxPaletteForScheme } from '../theme/syntax-palette'

// bin/deploy: a script with no extension, as most of a repo's bin/ is.
const DEPLOY_SCRIPT = [
  '#!/usr/bin/env bash',
  'set -euo pipefail',
  '# Build the release APK.',
  'for abi in arm64-v8a x86_64; do',
  '  ./gradlew assembleRelease -PreactNativeArchitectures="$abi"',
  'done'
].join('\n')

let renderers: ReactTestRenderer[] = []
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  act(() => renderers.forEach((r) => r.unmount()))
  renderers = []
  vi.useRealTimers()
})

function mount(element: ReactElement): ReactTestRenderer {
  let r: ReactTestRenderer | null = null
  act(() => {
    r = create(element)
  })
  renderers.push(r!)
  act(() => {
    vi.runAllTimers()
  })
  return r!
}

/** The colours of every span in the list's rows, once coloured. */
function spanColours(root: ReactTestRenderer): string[] {
  const list = root.root.findByType('FlatList' as never) as ReactTestInstance
  const colours: string[] = []
  ;(list.props.data as unknown[]).forEach((item, index) => {
    const row = mount(list.props.renderItem({ item, index }) as ReactElement)
    const code = row.root.find((node) => node.type === ('Text' as never) && node.props.ellipsizeMode === 'clip')
    for (const span of code.findAll((node) => node.type === ('Text' as never) && node !== code)) {
      colours.push((span.props.style as { color: string }).color)
    }
  })
  return colours
}

describe.each(['dark', 'light'] as const)('a script with no extension (%s)', (current) => {
  beforeEach(() => {
    scheme = current
  })

  it('is coloured as the shell script it is when opened from the explorer', () => {
    const palette = syntaxPaletteForScheme(current)
    const colours = spanColours(mount(createElement(MobileFilePreviewSourceText, { relativePath: 'bin/deploy', content: DEPLOY_SCRIPT })))
    expect(colours).toContain(palette.comment)
    expect(colours.some((colour) => colour === palette.keyword || colour === palette.control)).toBe(true)
  })

  it('is coloured in a file tab too', () => {
    const palette = syntaxPaletteForScheme(current)
    const colours = spanColours(
      mount(
        createElement(FileReader, {
          doc: { status: 'ready', kind: 'file', content: DEPLOY_SCRIPT, truncated: false, byteLength: DEPLOY_SCRIPT.length },
          title: 'deploy',
          relativePath: 'bin/deploy'
        } as never)
      )
    )
    expect(colours).toContain(palette.comment)
  })
})
