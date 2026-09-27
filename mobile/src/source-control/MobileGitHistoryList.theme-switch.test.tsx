// The history list keeps its commit renderer in a useCallback. While the palette was a static
// import that needed no dependency; read from the theme, a renderer that does not list it keeps
// painting the scheme it was made under after Settings → Appearance changes it (review of
// fix/theme-review, 2026-09-27). The repo's oxlint turns exhaustive-deps off, so only a test
// that switches the theme under a mounted list can see it.

import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, useTheme } from '../theme/theme-context'
import { darkColors, lightColors, type ThemePreference } from '../theme/tokens'
import type { RpcClient } from '../transport/rpc-client'
import { MobileGitHistoryList } from './MobileGitHistoryList'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: ({
    data,
    renderItem
  }: {
    data: { id: string }[]
    renderItem: (info: { item: { id: string } }) => ReactElement
  }) =>
    createElement(
      'FlatList',
      null,
      data.map((item) => createElement('Row', { key: item.id }, renderItem({ item })))
    ),
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: () => Promise.resolve(null), setItem: () => Promise.resolve() }
}))
vi.mock('lucide-react-native', () => ({ ChevronDown: 'ChevronDown', ChevronRight: 'ChevronRight' }))
vi.mock('../transport/client-context', () => ({ useForceReconnect: () => () => Promise.resolve() }))

const client = {
  sendRequest: vi.fn((method: string) =>
    Promise.resolve(
      method === 'git.history'
        ? {
            ok: true,
            result: {
              items: [{ id: 'commit-1', displayId: 'c0mm1t1', subject: 'Fix it', author: 'Ada', parentIds: [] }]
            }
          }
        : { ok: true, result: { entries: [{ path: 'src/app.ts', added: 3, removed: 1 }] } }
    )
  )
} as unknown as RpcClient

let switchTo: ((preference: ThemePreference) => void) | null = null

function Switcher(): null {
  switchTo = useTheme().setPreference
  return null
}

function flatStyle(style: unknown): Record<string, unknown> {
  const list = (Array.isArray(style) ? style.flat() : [style]).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  )
  return Object.assign({}, ...list)
}

describe('the commit history after an appearance change', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    switchTo = null
  })

  it('repaints an open commit row in the new theme', async () => {
    await act(async () => {
      renderer = create(
        <ThemeProvider initialPreference="light">
          <Switcher />
          <MobileGitHistoryList client={client} connState="connected" worktreeId="wt-1" hostId="host-1" bottomInset={0} />
        </ThemeProvider>
      )
      await Promise.resolve()
    })
    const header = renderer!.root.findAll(
      (node) => (node.type as unknown) === 'Pressable' && node.props.onPress !== undefined
    )[0]!
    await act(async () => {
      header.props.onPress()
      await Promise.resolve()
    })

    const paint = () => ({
      chevron: renderer!.root.findByType('ChevronDown' as never).props.color,
      subject: flatStyle(renderer!.root.findAll((node) => node.props.children === 'Fix it')[0]!.props.style).color,
      added: flatStyle(
        renderer!.root.findAll((node) => Array.isArray(node.props.children) && node.props.children[0] === '+')[0]!
          .props.style
      ).color
    })
    expect(paint()).toEqual({ chevron: lightColors.textMuted, subject: lightColors.text, added: lightColors.diffAddText })

    await act(async () => {
      switchTo!('dark')
      await Promise.resolve()
    })
    expect(paint()).toEqual({ chevron: darkColors.textMuted, subject: darkColors.text, added: darkColors.diffAddText })
  })
})
