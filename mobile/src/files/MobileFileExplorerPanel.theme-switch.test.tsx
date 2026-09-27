import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors, type ThemePreference } from '../theme/tokens'
import { ThemeProvider, useTheme } from '../theme/theme-context'
import { MobileFileExplorerPanel } from './MobileFileExplorerPanel'
import type { MobileDirEntry } from './file-tree'
import type { RpcResponse } from '../transport/types'

// The row renderer reads `colors` and `styles` off the live theme now, not the static
// `mobile-theme` import it used before the sweep. A row that keeps a memoized reference to either
// without listing it as a dependency would keep painting the scheme it first opened under, the
// same shape of bug fixed in MobileGitHistoryList.tsx (review of fix/theme-review, 2026-09-27:
// "The repo's oxlint turns exhaustive-deps off, so nothing flagged it"). This mounts the explorer,
// loads a row, switches the theme preference live, and checks the row repaints rather than only
// checking two separate initial mounts.

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

type MockClient = { sendRequest: ReturnType<typeof vi.fn> }

function ok(result: MobileDirEntry[]): RpcResponse {
  return { id: 'response-id', ok: true, result, _meta: { runtimeId: 'runtime-id' } }
}

const client: MockClient = {
  sendRequest: vi.fn(async () => ok([{ name: 'notes.txt', isDirectory: false }]))
}

vi.mock('../transport/client-context', () => ({
  useForceReconnect: () => vi.fn(),
  useHostClient: () => ({ client, state: 'connected' })
}))

let switchTo: ((preference: ThemePreference) => void) | null = null

function Switcher(): null {
  switchTo = useTheme().setPreference
  return null
}

function styleOf(node: { props: { style?: unknown } }): Record<string, unknown> {
  const raw = node.props.style
  const flat = (Array.isArray(raw) ? raw.flat() : [raw]).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  )
  return Object.assign({}, ...flat)
}

describe('a Files explorer row after an appearance change', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    switchTo = null
  })

  it('repaints the row title and icon in the new theme', async () => {
    await act(async () => {
      renderer = create(
        <ThemeProvider initialPreference="light">
          <Switcher />
          {createElement(MobileFileExplorerPanel, {
            hostId: 'host-a',
            worktreeId: 'worktree-a',
            name: 'Example Worktree',
            embedded: true
          })}
        </ThemeProvider>
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    const paint = () => {
      const title = renderer!.root
        .findAllByType('Text' as never)
        .find((node) => node.props.children === 'notes.txt')!
      const icon = renderer!.root.findByType('File' as never)
      return { title: styleOf(title).color, icon: icon.props.color as string }
    }

    expect(paint()).toEqual({ title: lightColors.text, icon: lightColors.textSecondary })

    await act(async () => {
      switchTo!('dark')
      await Promise.resolve()
    })

    expect(paint()).toEqual({ title: darkColors.text, icon: darkColors.textSecondary })
  })
})
