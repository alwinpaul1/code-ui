import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { MobileFileExplorerPanel } from './MobileFileExplorerPanel'

// The fourth screen the user reported dark in light mode (2026-09-27): the Files explorer, reached
// from a session's header folder icon. It imported the LEGACY static (dark-only) palette from
// mobile-theme instead of the live theme, so it always drew dark regardless of the phone's
// appearance setting.

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    ActivityIndicator: 'ActivityIndicator',
    FlatList: (props: {
      data: unknown[]
      keyExtractor: (item: unknown, index: number) => string
      renderItem: (info: {
        item: unknown
        index: number
        separators: Record<string, never>
      }) => ReactNode
    }) =>
      React.createElement(
        'FlatList',
        props,
        props.data.map((item, index) =>
          React.createElement(
            'FlatListItem',
            { key: props.keyExtractor(item, index) },
            props.renderItem({ item, index, separators: {} })
          )
        )
      ),
    Pressable: 'Pressable',
    StyleSheet: {
      create: (styles: unknown) => styles,
      hairlineWidth: 1
    },
    Text: 'Text',
    TextInput: 'TextInput',
    View: 'View',
    useColorScheme: () => 'light'
  }
})

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView'
}))

vi.mock('lucide-react-native', () => ({
  ChevronDown: 'ChevronDown',
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  File: 'File',
  FileText: 'FileText',
  Folder: 'Folder',
  Image: 'Image',
  Search: 'Search',
  X: 'X'
}))

vi.mock('../platform/haptics', () => ({
  triggerSelection: vi.fn()
}))

vi.mock('../navigation/route-handoff', () => ({
  useRouteHandoff: () => ({ back: vi.fn(), replace: vi.fn() })
}))

vi.mock('../transport/client-context', () => ({
  useForceReconnect: () => vi.fn(),
  useHostClient: () => ({ client: null, state: 'connecting' })
}))

function styleOf(node: { props: { style?: unknown } }): Record<string, unknown> {
  const raw = node.props.style
  const flat = (Array.isArray(raw) ? raw.flat() : [raw]).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  )
  return Object.assign({}, ...flat)
}

describe('the Files explorer', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('draws the panel and its title from the %s theme', (scheme, palette) => {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          {createElement(MobileFileExplorerPanel, {
            hostId: 'host-a',
            worktreeId: 'worktree-a',
            name: 'Example Worktree',
            embedded: true
          })}
        </ThemeProvider>
      )
    })
    const root = renderer!.root.findByProps({ testID: 'mobile-file-explorer-panel' })
    expect(styleOf(root).backgroundColor).toBe(palette.bg)
    const title = renderer!.root
      .findAllByType('Text' as never)
      .find((node) => node.props.children === 'Files')
    expect(title).toBeDefined()
    expect(styleOf(title!).color).toBe(palette.text)
  })
})
