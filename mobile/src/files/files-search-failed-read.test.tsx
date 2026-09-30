// The Files explorer's search when the host search failed, as opposed to answering "none".
//
// A rejected files.searchPaths (a timeout, a dropped socket, a refusal other than method_not_found,
// or a legacy inventory the host refused) ended with an empty list and no pending flag, which the
// explorer cannot tell from a real empty answer, so it said "No matches". The search runs only
// when the query changes, so one typed while the relay was down stayed "No matches" after the
// connection came back (reproduced on main 0b2c7a92). The explorer now says "Search failed" with
// Retry, and runs the query again once per new connection.

import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import type { RpcResponse } from '../transport/types'

const transport = vi.hoisted(
  (): {
    client: {
      sendRequest: ReturnType<typeof vi.fn>
      getLastConnectedAt: () => number | null
    } | null
    state: string
    lastConnectedAt: number | null
  } => ({ client: null, state: 'connected', lastConnectedAt: 1 })
)

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    ActivityIndicator: 'ActivityIndicator',
    FlatList: (props: {
      data: unknown[]
      keyExtractor: (item: unknown, index: number) => string
      renderItem: (info: { item: unknown; index: number; separators: Record<string, never> }) => ReactNode
    }) =>
      React.createElement(
        'FlatList',
        null,
        props.data.map((item, index) =>
          React.createElement(
            'FlatListItem',
            { key: props.keyExtractor(item, index) },
            props.renderItem({ item, index, separators: {} })
          )
        )
      ),
    Pressable: 'Pressable',
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: 'Text',
    TextInput: 'TextInput',
    View: 'View',
    useColorScheme: () => 'light'
  }
})
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }))
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
vi.mock('../platform/haptics', () => ({ triggerSelection: vi.fn() }))
vi.mock('../navigation/route-handoff', () => ({
  useRouteHandoff: () => ({ back: vi.fn(), replace: vi.fn() })
}))
vi.mock('../transport/client-context', () => ({
  useForceReconnect: () => vi.fn(),
  useHostClient: () => ({ client: transport.client, state: transport.state })
}))

const { MobileFileExplorerPanel } = await import('./MobileFileExplorerPanel')

const ROOT: RpcResponse = {
  id: 'dir',
  ok: true,
  result: [{ name: 'src', isDirectory: true }],
  _meta: { runtimeId: 'runtime-1' }
}

function found(paths: string[]): RpcResponse {
  return {
    id: 'search',
    ok: true,
    result: { files: paths.map((relativePath) => ({ relativePath })) },
    _meta: { runtimeId: 'runtime-1' }
  }
}

function refused(code: string, message: string): RpcResponse {
  return { id: 'refused', ok: false, error: { code, message }, _meta: { runtimeId: 'runtime-1' } }
}

describe('the Files search after the host search failed', () => {
  let renderer: ReactTestRenderer | null = null
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useFakeTimers()
    transport.state = 'connected'
    transport.lastConnectedAt = 1
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    transport.client = null
    warn.mockRestore()
    vi.useRealTimers()
  })

  function clientAnswering(search: (method: string) => Promise<RpcResponse>) {
    const sendRequest = vi.fn((method: string) =>
      method === 'files.readDir' ? Promise.resolve(ROOT) : search(method)
    )
    transport.client = { sendRequest, getLastConnectedAt: () => transport.lastConnectedAt }
    return sendRequest
  }

  function element(scheme: 'light' | 'dark') {
    return createElement(
      ThemeProvider,
      { initialPreference: scheme },
      createElement(MobileFileExplorerPanel, {
        hostId: 'host-a',
        worktreeId: 'wt-1',
        name: 'Example Worktree',
        embedded: true
      })
    )
  }

  async function settle(): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })
  }

  async function mountAndSearch(query: string, scheme: 'light' | 'dark' = 'light') {
    await act(async () => {
      renderer = create(element(scheme))
    })
    await settle()
    await act(async () => {
      renderer!.root.findByType('TextInput' as never).props.onChangeText(query)
    })
    await settle()
  }

  async function rerender(): Promise<void> {
    await act(async () => {
      renderer?.update(element('light'))
    })
    await settle()
  }

  function texts(): string[] {
    return (renderer?.root.findAllByType('Text' as never) ?? []).map((node) =>
      [node.props.children].flat().join('')
    )
  }

  function retry() {
    return renderer?.root
      .findAllByType('Pressable' as never)
      .find((node) => node.props.accessibilityLabel === 'Retry search')
  }

  function searches(sendRequest: ReturnType<typeof vi.fn>): number {
    return sendRequest.mock.calls.filter(([method]) => method === 'files.searchPaths').length
  }

  it('says the search failed, not "No matches", when the host search times out', async () => {
    clientAnswering(() => Promise.reject(new Error('Request timed out: files.searchPaths')))
    await mountAndSearch('readme')

    expect(texts()).not.toContain('No matches')
    expect(texts()).toContain('Search failed')
    expect(retry()).toBeDefined()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('Request timed out: files.searchPaths')
  })

  it('says the search failed when the host refuses it for a reason other than an old desktop', async () => {
    clientAnswering(() => Promise.resolve(refused('runtime_error', 'index unavailable')))
    await mountAndSearch('readme')

    expect(texts()).toContain('Search failed')
    expect(String(warn.mock.calls[0]?.[0])).toContain('index unavailable')
  })

  it('says the search failed when an old desktop also refuses its file list', async () => {
    clientAnswering((method) =>
      Promise.resolve(
        method === 'files.searchPaths'
          ? refused('method_not_found', 'Unknown method')
          : refused('runtime_error', 'list failed')
      )
    )
    await mountAndSearch('readme')

    expect(texts()).toContain('Search failed')
  })

  it('still searches an old desktop through its file list', async () => {
    clientAnswering((method) =>
      Promise.resolve(
        method === 'files.searchPaths'
          ? refused('method_not_found', 'Unknown method')
          : found(['docs/readme.md', 'src/app.ts'])
      )
    )
    await mountAndSearch('readme')

    expect(texts()).toContain('readme.md')
    expect(texts()).not.toContain('Search failed')
    expect(warn).not.toHaveBeenCalled()
  })

  it('searches again on Retry and shows the matches', async () => {
    let fail = true
    const sendRequest = clientAnswering(() =>
      fail ? Promise.reject(new Error('connection closed')) : Promise.resolve(found(['docs/readme.md']))
    )
    await mountAndSearch('readme')
    fail = false
    await act(async () => {
      retry()?.props.onPress()
    })
    await settle()

    expect(searches(sendRequest)).toBe(2)
    expect(texts()).toContain('readme.md')
    expect(texts()).not.toContain('Search failed')
  })

  it('runs a search typed while the relay was down again once the host reconnects, and not before', async () => {
    transport.state = 'reconnecting'
    let fail = true
    const sendRequest = clientAnswering(() =>
      fail
        ? Promise.reject(new Error('Not connected: files.searchPaths'))
        : Promise.resolve(found(['docs/readme.md']))
    )
    await mountAndSearch('readme')
    await rerender()
    await rerender()
    expect(searches(sendRequest)).toBe(1)
    expect(texts()).toContain('Search failed')

    fail = false
    transport.state = 'connected'
    transport.lastConnectedAt = 2
    await rerender()
    await rerender()

    expect(searches(sendRequest)).toBe(2)
    expect(texts()).toContain('readme.md')
  })

  it('still says "No matches" when the host answered with none', async () => {
    clientAnswering(() => Promise.resolve(found([])))
    await mountAndSearch('readme')

    expect(texts()).toContain('No matches')
    expect(texts()).not.toContain('Search failed')
    expect(retry()).toBeUndefined()
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('paints the failed search from the %s theme', async (scheme, palette) => {
    clientAnswering(() => Promise.reject(new Error('Request timed out: files.searchPaths')))
    await mountAndSearch('readme', scheme)

    const message = renderer!.root
      .findAllByType('Text' as never)
      .find((node) => node.props.children === 'Search failed')
    expect(message!.props.style.color).toBe(palette.danger)
    expect(retry()!.props.style.borderColor).toBe(palette.border)
    const retryText = retry()!.findByType('Text' as never)
    expect(retryText.props.style.color).toBe(palette.text)
  })
})
