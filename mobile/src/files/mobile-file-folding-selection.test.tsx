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
const clipboard = vi.hoisted(() => ({ writeText: vi.fn() }))
vi.mock('../platform/clipboard', () => ({ useClipboardWriter: () => clipboard }))
vi.mock('../components/MobileHtmlPreview', () => ({ MobileHtmlPreview: 'MobileHtmlPreview' }))
vi.mock('./MobileFilePdfPreview', () => ({ MobileFilePdfPreview: 'MobileFilePdfPreview' }))
vi.mock('./MobileFileMarkdownPreview', () => ({ MobileFileMarkdownPreview: 'MobileFileMarkdownPreview' }))
vi.mock('../session/MobileSessionDiffLineRow', () => ({ DiffLineRow: 'DiffLineRow' }))
vi.mock('../session/mobile-session-styles', () => ({ styles: {} }))
vi.mock('../ui/Txt', () => ({ Txt: 'Txt' }))
vi.mock('./mobile-file-preview-request', () => ({
  formatPreviewByteLength: (n: number) => `${n} B`
}))

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

import { MobileFilePreviewSourceText } from './MobileFilePreviewSourceText'
import { FileReader } from '../session/MobileSessionFileReader'

const SOURCE = [
  'def cell(em):', // 1
  '    for r in em:', // 2
  '        yield r', // 3
  '', // 4
  '    return None', // 5
  '', // 6
  'def other():', // 7
  '    pass' // 8
].join('\n')
const LINES = SOURCE.split('\n')

let renderer: ReactTestRenderer | null = null
let rows: ReactTestRenderer[] = []
beforeEach(() => {
  vi.useFakeTimers()
  clipboard.writeText.mockReset().mockResolvedValue(undefined)
})
afterEach(() => {
  act(() => {
    rows.forEach((r) => r.unmount())
    renderer?.unmount()
  })
  rows = []
  renderer = null
  vi.useRealTimers()
})

function openInExplorer(): void {
  act(() => {
    renderer = create(createElement(MobileFilePreviewSourceText, { relativePath: 'algorithm/lever_energy.py', content: SOURCE }))
  })
  act(() => {
    vi.runAllTimers()
  })
}

function openInFileTab(onAskAboutLines: ReturnType<typeof vi.fn>): void {
  act(() => {
    renderer = create(
      createElement(FileReader, {
        doc: { status: 'ready', kind: 'file', content: SOURCE, truncated: false, byteLength: SOURCE.length },
        title: 'lever_energy.py',
        relativePath: 'algorithm/lever_energy.py',
        onAskAboutLines
      } as never)
    )
  })
  act(() => {
    vi.runAllTimers()
  })
}

function rowElement(index: number): ReactElement {
  const list = renderer!.root.findByType('FlatList' as never) as ReactTestInstance
  return list.props.renderItem({ item: list.props.data[index], index }) as ReactElement
}

function rowProps(index: number): Record<string, unknown> {
  return rowElement(index).props as Record<string, unknown>
}

/** Presses the fold toggle drawn on list row `index`. */
function pressToggle(index: number, label: string): void {
  let drawn: ReactTestRenderer | null = null
  act(() => {
    drawn = create(rowElement(index))
  })
  rows.push(drawn!)
  const target = drawn!.root.find((node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')
  act(() => {
    target.props.onPress()
  })
}

function button(label: string): ReactTestInstance | undefined {
  return renderer!.root.findAll((node) => node.props.accessibilityLabel === label).find((node) => typeof node.props.onPress === 'function')
}

async function press(label: string): Promise<void> {
  const target = button(label)
  expect(target, `a "${label}" button`).toBeDefined()
  await act(async () => {
    await target!.props.onPress()
  })
}

describe.each(['dark', 'light'] as const)('selecting across a folded block (%s)', (current) => {
  beforeEach(() => {
    scheme = current
  })

  it('copies the hidden lines of a fold the selection spans, from the explorer', async () => {
    openInExplorer()
    pressToggle(1, 'Fold lines 2–3')
    // Rows: 1, 2 (folded), 4, 5, …; select from line 1 to line 5.
    act(() => {
      ;(rowProps(0).onLongPress as () => void)()
    })
    act(() => {
      ;(rowProps(3).onPress as () => void)()
    })
    await press('Copy lines 1–5')
    expect(clipboard.writeText).toHaveBeenCalledWith(LINES.slice(0, 5).join('\n'))
  })

  it('takes in the whole block when the folded header itself is selected', async () => {
    openInExplorer()
    pressToggle(0, 'Fold lines 1–5')
    act(() => {
      ;(rowProps(0).onLongPress as () => void)()
    })
    expect(rowProps(0).highlighted).toBe(true)
    await press('Copy lines 1–5')
    expect(clipboard.writeText).toHaveBeenCalledWith(LINES.slice(0, 5).join('\n'))
  })

  it('asks the chat about the file\'s own line numbers, hidden lines included', () => {
    const onAskAboutLines = vi.fn()
    openInFileTab(onAskAboutLines)
    pressToggle(1, 'Fold lines 2–3')
    act(() => {
      ;(rowProps(1).onLongPress as () => void)() // line 2, folded
    })
    act(() => {
      button('Ask about lines 2–3')!.props.onPress()
    })
    expect(onAskAboutLines).toHaveBeenCalledWith({ start: 2, end: 3 })
  })

  it('numbers the rows after a fold with the file\'s lines, for the long-press and the ask', () => {
    const onAskAboutLines = vi.fn()
    openInFileTab(onAskAboutLines)
    pressToggle(0, 'Fold lines 1–5')
    // Row 2 is line 7 now.
    act(() => {
      ;(rowProps(2).onLongPress as () => void)()
    })
    act(() => {
      button('Ask about line 7')!.props.onPress()
    })
    expect(onAskAboutLines).toHaveBeenCalledWith({ start: 7, end: 7 })
  })
})
