import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  FlatList: 'FlatList',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  View: 'View',
  StyleSheet: {
    create: (s: unknown) => s,
    flatten: (s: unknown) => s,
    hairlineWidth: 1
  },
  useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1, scale: 3 })
}))
vi.mock('lucide-react-native', () => ({ Check: 'Check', Copy: 'Copy', WrapText: 'WrapText' }))
// The code viewer's Copy button writes through this; expo-clipboard cannot load here.
vi.mock('../platform/clipboard', () => ({ useClipboardWriter: () => ({ writeText: vi.fn() }) }))

let scheme: 'light' | 'dark' = 'dark'
vi.mock('../theme/theme-context', async () => {
  const tokens = await vi.importActual<typeof import('../theme/tokens')>('../theme/tokens')
  const palettes = await vi.importActual<typeof import('../theme/syntax-palette')>(
    '../theme/syntax-palette'
  )
  const useTheme = () => ({
    colors: tokens.colorsForScheme(scheme),
    syntax: palettes.syntaxPaletteForScheme(scheme),
    fonts: tokens.fontFamily,
    isDark: scheme === 'dark'
  })
  return {
    useTheme,
    // The file preview's styles are a factory of the live theme (mobile-file-preview-styles.ts).
    useThemedStyles: <T,>(factory: (theme: ReturnType<typeof useTheme>) => T) => factory(useTheme())
  }
})

import { syntaxPaletteForScheme } from '../theme/syntax-palette'
import { MobileFilePreviewSourceText } from './MobileFilePreviewSourceText'

const SOURCE = ['def cell(em):', '    for r in em:', '        yield r', '    return None'].join('\n')

let renderer: ReactTestRenderer | null = null

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
})

function mount(props: Partial<Parameters<typeof MobileFilePreviewSourceText>[0]> = {}) {
  act(() => {
    renderer = create(
      createElement(MobileFilePreviewSourceText, {
        relativePath: 'algorithm/lever_energy.py',
        content: SOURCE,
        ...props
      })
    )
  })
  return renderer!
}

function list(r: ReactTestRenderer): ReactTestInstance {
  return r.root.findByType('FlatList' as never)
}

function texts(r: ReactTestRenderer): string[] {
  return r.root.findAllByType('Text' as never).map((node) => node.children.join(''))
}

describe('opening a code file from the file explorer', () => {
  it('shows it in the code viewer: numbered, one row per line, scrolling sideways', () => {
    // Why: this screen drew the whole file as one Text with no line numbers,
    // wrapped at the screen edge, in the UI face (2026-09-26).
    const r = mount()
    const sideways = r.root.findAll(
      (node) => (node.type as unknown) === 'ScrollView' && node.props.horizontal === true
    )
    expect(sideways).toHaveLength(1)
    expect(list(r).props.data).toHaveLength(4)
    const row = list(r).props.renderItem({ item: null, index: 1 })
    expect(row.props.number).toBe(2)
    expect(row.props.guides).toBe(1)
  })

  it('opens at the line a link pointed to', () => {
    expect(list(mount({ initialLine: 3 })).props.initialScrollIndex).toBe(2)
  })

  it('says when the host sent only part of the file, and names what it shows, not a size', () => {
    // Orca's files.read never tells the phone a cut file's size: its byteLength is what it read,
    // 524289 for any file over the cap, so "File size: 512 KB" was said of a 5 MB log.
    const r = mount({ truncated: true })
    const notes = texts(r).filter((text) => text.startsWith('Preview truncated'))
    expect(notes).toEqual(['Preview truncated: showing the first 512 KB of the file.'])
  })

  it('pretty-prints a minified JSON file and says so', () => {
    const r = mount({ relativePath: 'package.json', content: '{"name":"orca","private":true}' })
    // The list draws line indices (folded lines are skipped); read the rows.
    const drawn = (list(r).props.data as unknown[]).map((item, index) => {
      const line = list(r).props.renderItem({ item, index })
      return (line.props.segments as { text: string }[]).map((segment) => segment.text).join('')
    })
    expect(drawn).toEqual(['{', '  "name": "orca",', '  "private": true', '}'])
    expect(texts(r).some((text) => text.startsWith('Formatted for reading'))).toBe(true)
  })

  it.each(['light', 'dark'] as const)('paints the %s scheme’s code surface', (name) => {
    scheme = name
    const r = mount()
    const surface = syntaxPaletteForScheme(name).surface
    expect(r.root.findAll((node) => node.props.style?.backgroundColor === surface).length).toBeGreaterThan(0)
  })
})
