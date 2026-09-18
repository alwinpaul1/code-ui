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
  View: 'View',
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 }
}))
// Why: lucide, the WebView preview, the PDF view and the highlighter all reach
// for React Native internals the host-tag mock above removed — matches
// mobile-session-file-reader-markdown.test.tsx. MobileSyntaxLine is mocked so
// renderItem's returned element's props (onLongPress, highlighted, …) can be
// read directly without needing a second render pass.
vi.mock('lucide-react-native', () => ({
  Copy: 'Copy',
  MessageSquare: 'MessageSquare',
  Send: 'Send',
  X: 'X'
}))
vi.mock('../components/MobileHtmlPreview', () => ({ MobileHtmlPreview: 'MobileHtmlPreview' }))
vi.mock('../files/MobileFilePdfPreview', () => ({ MobileFilePdfPreview: 'MobileFilePdfPreview' }))
vi.mock('../components/MobileSyntaxSegments', () => ({
  MobileSyntaxLine: 'MobileSyntaxLine',
  MobileSyntaxSegments: 'MobileSyntaxSegments'
}))
vi.mock('./MobileSessionDiffLineRow', () => ({ DiffLineRow: 'DiffLineRow' }))
vi.mock('./mobile-session-styles', () => ({ styles: {} }))
vi.mock('./mobile-file-syntax', () => ({
  buildPlainMobileDiffSyntaxLines: () => [],
  highlightMobileCode: () => ({ segments: [] }),
  highlightMobileDiffLines: () => [],
  resolveMobileSyntaxLanguage: () => 'plaintext'
}))
vi.mock('../files/MobileFileMarkdownPreview', () => ({
  MobileFileMarkdownPreview: 'MobileFileMarkdownPreview'
}))
vi.mock('../ui/Txt', () => ({ Txt: 'Txt' }))

let scheme: 'light' | 'dark' = 'light'
const THEME_COLORS = {
  light: {
    accentSoft: '#F4E3DA',
    bgPanelGlass: 'rgba(251,250,246,1)',
    border: '#E1DDD2',
    textSecondary: '#55514A',
    shadow: '#000000'
  },
  dark: {
    accentSoft: '#3A2A22',
    bgPanelGlass: 'rgba(33,31,28,1)',
    border: '#3A3630',
    textSecondary: '#B8B4AB',
    shadow: '#000000'
  }
}
vi.mock('../theme/theme-context', () => ({
  useTheme: () => ({
    colors: THEME_COLORS[scheme],
    space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
    radius: { xl: 24 },
    type: { label: { size: 13 } },
    isDark: scheme === 'dark'
  })
}))

import { FileReader } from './MobileSessionFileReader'

const THREE_LINES = 'line one\nline two\nline three'

function renderFile(
  content: string,
  onAskAboutLines = vi.fn()
): { renderer: ReactTestRenderer; onAskAboutLines: ReturnType<typeof vi.fn> } {
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(
      createElement(FileReader, {
        doc: { status: 'ready', kind: 'file', content, truncated: false, byteLength: content.length },
        title: 'notes.txt',
        relativePath: 'src/notes.txt',
        onAskAboutLines
      })
    )
  })
  if (!renderer) {
    throw new Error('FileReader did not render')
  }
  return { renderer, onAskAboutLines }
}

function flatListRenderItem(
  renderer: ReactTestRenderer
): (args: { item: unknown; index: number }) => ReactTestInstance {
  const list = renderer.root.findByType('FlatList' as never)
  return list.props.renderItem
}

function lineElement(renderer: ReactTestRenderer, index: number) {
  return flatListRenderItem(renderer)({ item: [], index })
}

function findActionBar(renderer: ReactTestRenderer): ReactTestInstance | null {
  const bars = renderer.root.findAll(
    (node) => node.props.testID === 'file-reader-line-action-bar'
  )
  return bars[0] ?? null
}

describe('selecting lines in the file reader to ask about them', () => {
  let renderer: ReactTestRenderer | null = null
  beforeEach(() => {
    scheme = 'light'
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('shows no action bar until a line is long-pressed', () => {
    ;({ renderer } = renderFile(THREE_LINES))
    expect(findActionBar(renderer)).toBeNull()
  })

  it('starts a one-line selection on long-press and labels it singular', () => {
    ;({ renderer } = renderFile(THREE_LINES))
    act(() => {
      lineElement(renderer!, 1).props.onLongPress()
    })
    const bar = findActionBar(renderer)
    expect(bar).not.toBeNull()
    const askLines = bar!.findAll((n) => n.props.accessibilityLabel === 'Ask about line 2')
    expect(askLines.length).toBeGreaterThan(0)
  })

  it('marks the long-pressed line highlighted and its neighbours not', () => {
    ;({ renderer } = renderFile(THREE_LINES))
    act(() => {
      lineElement(renderer!, 1).props.onLongPress()
    })
    expect(lineElement(renderer!, 0).props.highlighted).toBe(false)
    expect(lineElement(renderer!, 1).props.highlighted).toBe(true)
    expect(lineElement(renderer!, 2).props.highlighted).toBe(false)
  })

  it('extends the range toward a line tapped afterward, keeping the long-pressed line as the anchor', () => {
    ;({ renderer } = renderFile(THREE_LINES))
    act(() => {
      lineElement(renderer!, 1).props.onLongPress() // long-press line 2
    })
    act(() => {
      lineElement(renderer!, 2).props.onPress() // tap line 3 to extend
    })
    expect(lineElement(renderer!, 0).props.highlighted).toBe(false)
    expect(lineElement(renderer!, 1).props.highlighted).toBe(true)
    expect(lineElement(renderer!, 2).props.highlighted).toBe(true)
    const bar = findActionBar(renderer)
    const askLines = bar!.findAll((n) => n.props.accessibilityLabel === 'Ask about lines 2–3')
    expect(askLines.length).toBeGreaterThan(0)
  })

  it('disables native text selection on every line once a selection is active, so extending by tap is unambiguous', () => {
    ;({ renderer } = renderFile(THREE_LINES))
    expect(lineElement(renderer!, 0).props.selectable).toBe(true)
    act(() => {
      lineElement(renderer!, 1).props.onLongPress()
    })
    expect(lineElement(renderer!, 0).props.selectable).toBe(false)
    expect(lineElement(renderer!, 2).props.selectable).toBe(false)
  })

  it('calls onAskAboutLines with the selected range exactly once, then clears the selection', () => {
    let onAskAboutLines = vi.fn()
    ;({ renderer, onAskAboutLines } = renderFile(THREE_LINES, onAskAboutLines))
    act(() => {
      lineElement(renderer!, 0).props.onLongPress()
    })
    act(() => {
      lineElement(renderer!, 1).props.onPress()
    })
    const bar = findActionBar(renderer)!
    const askLinesButton = bar
      .findAll((n) => n.props.accessibilityLabel === 'Ask about lines 1–2')
      .find((n) => typeof n.props.onPress === 'function')!
    act(() => {
      askLinesButton.props.onPress()
    })
    expect(onAskAboutLines).toHaveBeenCalledTimes(1)
    expect(onAskAboutLines).toHaveBeenCalledWith({ start: 1, end: 2 })
    // Insert-once: the bar is gone, so there is nothing left to tap again —
    // a re-render cannot fire the callback a second time on its own.
    expect(findActionBar(renderer)).toBeNull()
  })

  it('calls onAskAboutLines with a null range for "Ask about file"', () => {
    let onAskAboutLines = vi.fn()
    ;({ renderer, onAskAboutLines } = renderFile(THREE_LINES, onAskAboutLines))
    act(() => {
      lineElement(renderer!, 0).props.onLongPress()
    })
    const bar = findActionBar(renderer)!
    const askFileButton = bar
      .findAll((n) => n.props.accessibilityLabel === 'Ask about file')
      .find((n) => typeof n.props.onPress === 'function')!
    act(() => {
      askFileButton.props.onPress()
    })
    expect(onAskAboutLines).toHaveBeenCalledTimes(1)
    expect(onAskAboutLines).toHaveBeenCalledWith(null)
  })

  it('dismisses the selection without calling back when the cancel control is pressed', () => {
    let onAskAboutLines = vi.fn()
    ;({ renderer, onAskAboutLines } = renderFile(THREE_LINES, onAskAboutLines))
    act(() => {
      lineElement(renderer!, 0).props.onLongPress()
    })
    const bar = findActionBar(renderer)!
    const dismissButton = bar
      .findAll((n) => n.props.accessibilityLabel === 'Cancel line selection')
      .find((n) => typeof n.props.onPress === 'function')!
    act(() => {
      dismissButton.props.onPress()
    })
    expect(onAskAboutLines).not.toHaveBeenCalled()
    expect(findActionBar(renderer)).toBeNull()
  })

  it('lets the only line of a one-line file be selected, singular label', () => {
    ;({ renderer } = renderFile('only line'))
    act(() => {
      lineElement(renderer!, 0).props.onLongPress()
    })
    const bar = findActionBar(renderer)!
    expect(bar.findAll((n) => n.props.accessibilityLabel === 'Ask about line 1').length).toBeGreaterThan(0)
  })

  it('lets the LAST line of a multi-line file be selected on its own', () => {
    ;({ renderer } = renderFile(THREE_LINES))
    act(() => {
      lineElement(renderer!, 2).props.onLongPress() // line 3, the last
    })
    const bar = findActionBar(renderer)!
    expect(bar.findAll((n) => n.props.accessibilityLabel === 'Ask about line 3').length).toBeGreaterThan(0)
  })

  it('wires no long-press at all on an empty file, so the action bar can never show', () => {
    ;({ renderer } = renderFile(''))
    const list = renderer.root.findByType('FlatList' as never)
    // splitSyntaxIntoLines still yields one (empty) line for '' — the guard
    // is content.length, not the line count.
    expect(list.props.data.length).toBe(1)
    expect(lineElement(renderer, 0).props.onLongPress).toBeUndefined()
    expect(findActionBar(renderer)).toBeNull()
  })

  it('renders no selection UI at all when the caller has no chat surface to send it to', () => {
    let noHandlerRenderer: ReactTestRenderer | null = null
    act(() => {
      noHandlerRenderer = create(
        createElement(FileReader, {
          doc: { status: 'ready', kind: 'file', content: THREE_LINES, truncated: false, byteLength: 10 },
          title: 'notes.txt',
          relativePath: 'src/notes.txt'
          // onAskAboutLines omitted
        })
      )
    })
    const list = noHandlerRenderer!.root.findByType('FlatList' as never)
    expect(list.props.renderItem({ item: [], index: 0 }).props.onLongPress).toBeUndefined()
    // selectable falls back to MobileSyntaxLine's own default (true) — passed as undefined, not forced off.
    expect(list.props.renderItem({ item: [], index: 0 }).props.selectable).toBeUndefined()
    act(() => noHandlerRenderer?.unmount())
  })

  it('paints the selection highlight with the light-mode accent-soft token', () => {
    scheme = 'light'
    ;({ renderer } = renderFile(THREE_LINES))
    act(() => {
      lineElement(renderer!, 0).props.onLongPress()
    })
    const highlighted = lineElement(renderer!, 0)
    expect(highlighted.props.highlightStyle).toEqual({ backgroundColor: THEME_COLORS.light.accentSoft })
  })

  it('paints the selection highlight with the dark-mode accent-soft token', () => {
    scheme = 'dark'
    ;({ renderer } = renderFile(THREE_LINES))
    act(() => {
      lineElement(renderer!, 0).props.onLongPress()
    })
    const highlighted = lineElement(renderer!, 0)
    expect(highlighted.props.highlightStyle).toEqual({ backgroundColor: THEME_COLORS.dark.accentSoft })
  })
})
