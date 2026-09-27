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

const SOURCE = ['def cell(em):', '    for r in em:', '        yield r', '    return None'].join('\n')

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

function openInExplorer(content = SOURCE, extra: Record<string, unknown> = {}): void {
  act(() => {
    renderer = create(
      createElement(MobileFilePreviewSourceText, { relativePath: 'algorithm/lever_energy.py', content, ...extra })
    )
  })
  act(() => {
    vi.runAllTimers()
  })
}

function openInFileTab(onAskAboutLines = vi.fn()): void {
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

function row(index: number): ReactElement {
  const list = renderer!.root.findByType('FlatList' as never) as ReactTestInstance
  return list.props.renderItem({ item: list.props.data[index], index }) as ReactElement
}

function rowProps(index: number): Record<string, unknown> {
  return row(index).props as Record<string, unknown>
}

function button(label: string): ReactTestInstance | undefined {
  return renderer!.root
    .findAll((node) => node.props.accessibilityLabel === label)
    .find((node) => typeof node.props.onPress === 'function')
}

async function press(label: string): Promise<void> {
  const target = button(label)
  expect(target, `a "${label}" button`).toBeDefined()
  await act(async () => {
    await target!.props.onPress()
  })
}

function texts(): string[] {
  return renderer!.root.findAllByType('Text' as never).map((node) => node.children.join(''))
}

describe.each(['dark', 'light'] as const)('copying code out of a file opened from the explorer (%s)', (current) => {
  beforeEach(() => {
    scheme = current
  })

  it('lets a block of code be selected and copied: a loop header and its body', async () => {
    openInExplorer()
    act(() => {
      ;(rowProps(1).onLongPress as () => void)() // for r in em:
    })
    act(() => {
      ;(rowProps(2).onPress as () => void)() // yield r
    })
    expect(rowProps(1).highlighted).toBe(true)
    expect(rowProps(2).highlighted).toBe(true)
    expect(rowProps(0).highlighted).toBe(false)
    await press('Copy lines 2–3')
    expect(clipboard.writeText).toHaveBeenCalledWith('    for r in em:\n        yield r')
    // Copied: the selection and its bar are gone.
    expect(button('Copy lines 2–3')).toBeUndefined()
    expect(rowProps(1).highlighted).toBe(false)
  })

  it('highlights the selected lines in the code palette\'s selection fill', () => {
    openInExplorer()
    act(() => {
      ;(rowProps(0).onLongPress as () => void)()
    })
    expect(rowProps(0).highlightStyle).toEqual({ backgroundColor: syntaxPaletteForScheme(current).selection })
  })

  it('copies the whole file from the viewer\'s toolbar', async () => {
    openInExplorer()
    await press('Copy file')
    expect(clipboard.writeText).toHaveBeenCalledWith(SOURCE)
  })

  it('says it copies only the loaded text of a truncated preview', async () => {
    openInExplorer(SOURCE, { truncated: true, byteLength: 9_000_000 })
    expect(button('Copy file')).toBeUndefined()
    await press('Copy loaded text')
    expect(clipboard.writeText).toHaveBeenCalledWith(SOURCE)
  })

  it('copies the only line of a one-line file', async () => {
    openInExplorer('print("hi")')
    act(() => {
      ;(rowProps(0).onLongPress as () => void)()
    })
    await press('Copy line 1')
    expect(clipboard.writeText).toHaveBeenCalledWith('print("hi")')
  })

  it('offers no line range in pretty-printed JSON, whose lines are not the file\'s, and still copies the file', async () => {
    const minified = '{"name":"orca","tags":["a","b"]}'
    openInExplorer(minified, { relativePath: 'config/settings.json' })
    // The rows are the viewer's lines, not the file's: "Copy lines 2–3"
    // would copy text the file does not hold.
    expect(rowProps(1).onLongPress).toBeUndefined()
    await press('Copy file')
    expect(clipboard.writeText).toHaveBeenCalledWith(minified)
  })

  it('copies lines from a Windows file with the file\'s own CRLF line breaks', async () => {
    openInExplorer('def cell(em):\r\n    for r in em:\r\n        yield r\r\n')
    act(() => {
      ;(rowProps(0).onLongPress as () => void)()
    })
    act(() => {
      ;(rowProps(1).onPress as () => void)()
    })
    await press('Copy lines 1–2')
    expect(clipboard.writeText).toHaveBeenCalledWith('def cell(em):\r\n    for r in em:')
  })

  it('copies lines from a file with mixed line breaks each with its own', async () => {
    // One CRLF line made every copied line CRLF (review, 2026-09-27).
    openInExplorer('def cell(em):\r\n    for r in em:\n        yield r\r\n    return None')
    act(() => {
      ;(rowProps(0).onLongPress as () => void)()
    })
    act(() => {
      ;(rowProps(3).onPress as () => void)()
    })
    await press('Copy lines 1–4')
    expect(clipboard.writeText).toHaveBeenCalledWith('def cell(em):\r\n    for r in em:\n        yield r\r\n    return None')
  })

  it('offers nothing to copy in an empty file', () => {
    openInExplorer('')
    expect(button('Copy file')).toBeUndefined()
    expect(rowProps(0).onLongPress).toBeUndefined()
  })

  it('says so, and keeps the selection, when the clipboard refuses the lines', async () => {
    clipboard.writeText.mockRejectedValue(new Error('the clipboard did not accept this text'))
    openInExplorer()
    act(() => {
      ;(rowProps(1).onLongPress as () => void)()
    })
    await press('Copy line 2')
    expect(texts().some((text) => text.includes("Couldn't copy") && text.includes('did not accept'))).toBe(true)
    expect(button('Copy line 2')).toBeDefined()
  })

  it('says so when the clipboard refuses the whole file', async () => {
    clipboard.writeText.mockRejectedValue(new Error('the clipboard did not accept this text'))
    openInExplorer()
    await press('Copy file')
    expect(texts().some((text) => text.includes("Couldn't copy") && text.includes('did not accept'))).toBe(true)
  })
})

describe.each(['dark', 'light'] as const)('copying code out of a file tab (%s)', (current) => {
  beforeEach(() => {
    scheme = current
  })

  it('copies the whole file from the toolbar, and the selected lines from the ask bar', async () => {
    const onAskAboutLines = vi.fn()
    openInFileTab(onAskAboutLines)
    await press('Copy file')
    expect(clipboard.writeText).toHaveBeenLastCalledWith(SOURCE)
    act(() => {
      ;(rowProps(1).onLongPress as () => void)()
    })
    act(() => {
      ;(rowProps(2).onPress as () => void)()
    })
    // The ask actions are still there beside the copy.
    expect(button('Ask about lines 2–3')).toBeDefined()
    expect(button('Ask about file')).toBeDefined()
    await press('Copy lines 2–3')
    expect(clipboard.writeText).toHaveBeenLastCalledWith('    for r in em:\n        yield r')
    expect(onAskAboutLines).not.toHaveBeenCalled()
  })
})
